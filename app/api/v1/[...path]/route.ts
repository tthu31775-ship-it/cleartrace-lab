import { z, ZodError } from 'zod';
import openapi from '@/docs/openapi.json';
import { authenticate, authorize, hashToken, verifyOrigin } from '@/lib/server/auth';
import { account, ApiProblem, audit, database, dataset, first, now, rows, uuid } from '@/lib/server/db';
import { ensureSeed } from '@/lib/server/seed';
import { bootstrap, createTask, exportTask, getAccount, getAccounts, getDatasets, getIntegrations, getLogs, getMembers, getTask, getTasks, graphOf, importDataset, runTask } from '@/lib/server/service';
import { ImportError } from '@/lib/core/import';
import type { User } from '@/lib/contracts';
export const dynamic = 'force-dynamic';
const text = z.string().trim().min(1).max(120);
const importSchema = z.object({ name: text, source: z.string().trim().min(1).max(200).default('团队导入'), format: z.enum(['csv', 'json']), content: z.string().min(1).max(5000000), dryRun: z.boolean().default(true), description: z.string().max(1000).optional() });
const taskSchema = z.object({ name: text, datasetId: z.string().min(1).max(100), modelId: z.enum(['baseline-v1', 'external']).default('baseline-v1'), threshold: z.number().int().min(30).max(95).default(65) });
const roles = z.enum(['editor', 'reviewer', 'viewer']);
const memberSchema = z.object({ name: text, email: z.string().email().max(200).transform(x => x.toLowerCase()), role: roles });
const reviewSchema = z.object({ status: z.enum(['confirmed', 'dismissed', 'pending']), note: z.string().trim().min(1, '请填写复核依据').max(1000) });
async function readBody(request: Request) {
    if (Number(request.headers.get('content-length') || 0) > 5242880)
        throw new ApiProblem(413, 'body_too_large', '上传内容不能超过 5 MB');
    const reader = request.body?.getReader();
    if (!reader)
        throw new ApiProblem(400, 'invalid_json', '请求体不能为空');
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
        while (true) {
            const next = await reader.read();
            if (next.done)
                break;
            length += next.value.byteLength;
            if (length > 5242880) {
                await reader.cancel();
                throw new ApiProblem(413, 'body_too_large', '上传内容不能超过 5 MB');
            }
            chunks.push(next.value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const buffer = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return JSON.parse(new TextDecoder().decode(buffer));
    }
    catch {
        throw new ApiProblem(400, 'invalid_json', '请求体必须为有效 JSON');
    }
}
const json = (data: unknown, status = 200) => Response.json({ data }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
async function handle(request: Request, context: {
    params: Promise<{
        path: string[];
    }>;
}) {
    try {
        const { path } = await context.params;
        const key = path.join('/');
        const method = request.method;
        const params = new URL(request.url).searchParams;
        if (method === 'GET' && key === 'health') {
            const db = database();
            await db.prepare('SELECT 1 AS ok').first();
            return json({ status: 'ok', database: 'connected', service: 'cleartrace', version: '1.0.0', time: now() });
        }
        if (method === 'GET' && key === 'openapi')
            return Response.json(openapi, { headers: { 'Cache-Control': 'public, max-age=300' } });
        const db = database();
        const user = await authenticate(request, db);
        if (method !== 'GET' && method !== 'HEAD')
            verifyOrigin(request);
        await ensureSeed(db);
        if (method === 'GET' && key === 'bootstrap')
            return json(await bootstrap(db, user));
        if (method === 'GET' && key === 'session')
            return json(user);
        if (method === 'GET' && key === 'dashboard') {
            const b = await bootstrap(db, user);
            return json({ stats: b.stats, trend: b.trend, distribution: b.distribution });
        }
        if (method === 'GET' && key === 'datasets')
            return json(await getDatasets(db));
        if (method === 'POST' && (key === 'datasets/import' || key === 'datasets')) {
            authorize(user, ['admin', 'editor']);
            const body = importSchema.parse(await readBody(request));
            return json(await importDataset(db, user, body), body.dryRun ? 200 : 201);
        }
        if (path[0] === 'datasets' && path.length === 2) {
            const found = await first(db, 'SELECT * FROM datasets WHERE id=?', path[1]);
            if (!found)
                throw new ApiProblem(404, 'dataset_not_found', '数据集不存在');
            if (method === 'GET')
                return json({ dataset: dataset(found), accounts: await getAccounts(db, new URLSearchParams({ datasetId: path[1] })) });
            if (method === 'PATCH') {
                authorize(user, ['admin', 'editor']);
                const body = z.object({ name: text.optional(), description: z.string().max(1000).optional() }).parse(await readBody(request));
                await db.prepare('UPDATE datasets SET name=?,description=? WHERE id=?').bind(body.name ?? found.name, body.description ?? found.description, path[1]).run();
                await audit(db, user, '更新数据集', String(found.name));
                return json(dataset((await first(db, 'SELECT * FROM datasets WHERE id=?', path[1]))!));
            }
            if (method === 'DELETE') {
                authorize(user, ['admin']);
                if (await first(db, 'SELECT id FROM tasks WHERE dataset_id=? LIMIT 1', path[1]))
                    throw new ApiProblem(409, 'dataset_in_use', '已有任务引用该数据集，不能删除');
                await db.prepare('DELETE FROM datasets WHERE id=?').bind(path[1]).run();
                await audit(db, user, '删除数据集', String(found.name));
                return json({ deleted: true });
            }
        }
        if (method === 'GET' && key === 'accounts')
            return json(await getAccounts(db, params));
        if (path[0] === 'accounts' && path.length >= 2) {
            const a = await getAccount(db, path[1]);
            if (method === 'GET' && path.length === 2)
                return json({ account: a, reviews: await rows(db, 'SELECT id,status,note,reviewer_name AS reviewerName,created_at AS createdAt FROM reviews WHERE account_id=? ORDER BY created_at DESC', a.id), results: await rows(db, 'SELECT r.id,r.score,r.risk_level AS riskLevel,r.model_version AS modelVersion,r.created_at AS createdAt,t.name AS taskName,t.id AS taskId FROM results r JOIN tasks t ON t.id=r.task_id WHERE r.account_id=? ORDER BY r.created_at DESC', a.id) });
            if (method === 'POST' && path[2] === 'review' && path.length === 3) {
                authorize(user, ['admin', 'editor', 'reviewer']);
                const body = reviewSchema.parse(await readBody(request));
                await db.batch([db.prepare('INSERT INTO reviews(id,account_id,status,note,reviewer_id,reviewer_name,created_at) VALUES(?,?,?,?,?,?,?)').bind(uuid('review'), a.id, body.status, body.note, user.id, user.name, now()), db.prepare('UPDATE accounts SET review_status=? WHERE id=?').bind(body.status, a.id)]);
                await audit(db, user, '账号人工复核', a.accountId, `状态 ${body.status}`);
                return json(await getAccount(db, a.id));
            }
        }
        if (method === 'GET' && key === 'tasks')
            return json(await getTasks(db));
        if (method === 'POST' && key === 'tasks') {
            authorize(user, ['admin', 'editor']);
            return json(await createTask(db, user, taskSchema.parse(await readBody(request))), 201);
        }
        if (path[0] === 'tasks' && path.length >= 2) {
            if (method === 'GET' && path.length === 2) {
                const t = await getTask(db, path[1]);
                const result = await rows(db, 'SELECT a.*,r.score AS risk_score,r.risk_level,r.reasons,r.model_version AS model_version FROM results r JOIN accounts a ON a.id=r.account_id WHERE r.task_id=? ORDER BY r.score DESC', t.id);
                return json({ task: t, results: result.map(account) });
            }
            if (method === 'POST' && path[2] === 'run' && path.length === 3) {
                authorize(user, ['admin', 'editor']);
                return json(await runTask(db, user, path[1]));
            }
            if (method === 'POST' && path[2] === 'cancel' && path.length === 3) {
                authorize(user, ['admin', 'editor']);
                const t = await getTask(db, path[1]);
                if (!['queued', 'failed'].includes(t.status))
                    throw new ApiProblem(409, 'cannot_cancel', '只有排队中或失败的任务可以取消');
                await db.prepare("UPDATE tasks SET status='cancelled',completed_at=? WHERE id=? AND status IN ('queued','failed')").bind(now(), t.id).run();
                await audit(db, user, '取消摸排任务', t.name);
                return json(await getTask(db, t.id));
            }
            if (method === 'GET' && path[2] === 'export' && path.length === 3)
                return await exportTask(db, path[1]);
        }
        if (method === 'GET' && key === 'graph') {
            const filtered = new URLSearchParams(params);
            filtered.set('limit', '5000');
            return json(graphOf(await getAccounts(db, filtered), Number(params.get('limit')) || 60));
        }
        if (method === 'GET' && key === 'logs')
            return json(await getLogs(db));
        if (method === 'GET' && key === 'integrations')
            return json(await getIntegrations(db));
        if (method === 'PUT' && key === 'integrations') {
            authorize(user, ['admin']);
            const body = z.object({ externalEnabled: z.boolean() }).parse(await readBody(request));
            await db.prepare("INSERT INTO settings(key,value,updated_at) VALUES('external_enabled',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(String(body.externalEnabled), now()).run();
            await audit(db, user, '更新算法接入', '外部模型', body.externalEnabled ? '启用' : '停用');
            return json(await getIntegrations(db));
        }
        if (key === 'members' || path[0] === 'members') {
            authorize(user, ['admin']);
            if (method === 'GET' && path.length === 1)
                return json(await getMembers(db));
            if (method === 'POST' && path.length === 1) {
                const body = memberSchema.parse(await readBody(request));
                const existing = await first(db, 'SELECT * FROM members WHERE email=?', body.email);
                if (existing?.role === 'admin')
                    throw new ApiProblem(409, 'owner_role_fixed', '不能通过成员接口修改管理员角色');
                if (existing) {
                    await db.prepare('UPDATE members SET name=?,role=? WHERE id=?').bind(body.name, body.role, existing.id).run();
                }
                else {
                    await db.prepare('INSERT INTO members(id,user_id,email,name,role,created_at) VALUES(?,NULL,?,?,?,?)').bind(uuid('member'), body.email, body.name, body.role, now()).run();
                }
                await audit(db, user, '设置成员权限', body.name, body.role);
                return json((await getMembers(db)).find(m => m.email === body.email), 201);
            }
            if (method === 'DELETE' && path.length === 2) {
                const existing = await first(db, 'SELECT * FROM members WHERE id=?', path[1]);
                if (!existing)
                    throw new ApiProblem(404, 'member_not_found', '成员不存在');
                if (existing.role === 'admin')
                    throw new ApiProblem(409, 'owner_role_fixed', '管理员账号不可删除');
                await db.prepare('DELETE FROM members WHERE id=?').bind(path[1]).run();
                await audit(db, user, '移除成员', String(existing.name));
                return json({ deleted: true });
            }
        }
        if (key === 'tokens' || path[0] === 'tokens') {
            authorize(user, ['admin']);
            if (method === 'GET' && path.length === 1)
                return json(await rows(db, 'SELECT id,name,role,created_at AS createdAt,revoked_at AS revokedAt FROM api_tokens ORDER BY created_at DESC'));
            if (method === 'POST' && path.length === 1) {
                const body = z.object({ name: text, role: roles.default('editor') }).parse(await readBody(request));
                const id = uuid('token');
                const token = 'ct_' + [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join('');
                const stamp = now();
                await db.prepare('INSERT INTO api_tokens(id,name,token_hash,role,created_at) VALUES(?,?,?,?,?)').bind(id, body.name, await hashToken(token), body.role, stamp).run();
                await audit(db, user, '创建接口令牌', body.name, body.role);
                return json({ id, name: body.name, role: body.role, createdAt: stamp, token }, 201);
            }
            if (method === 'DELETE' && path.length === 2) {
                const result = await db.prepare('UPDATE api_tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(now(), path[1]).run();
                if (!result.meta.changes)
                    throw new ApiProblem(404, 'token_not_found', '令牌不存在或已撤销');
                await audit(db, user, '撤销接口令牌', path[1]);
                return json({ revoked: true });
            }
        }
        throw new ApiProblem(404, 'not_found', '接口不存在');
    }
    catch (e) {
        if (e instanceof ZodError)
            return Response.json({ error: { code: 'validation_error', message: e.issues[0]?.message || '请求参数不符合协议', details: e.issues.map(x => ({ path: x.path.join('.'), message: x.message })) } }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
        if (e instanceof ImportError)
            return Response.json({ error: { code: 'import_error', message: e.message } }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
        const p = e instanceof ApiProblem ? e : new ApiProblem(500, 'internal_error', '服务暂时无法完成请求，请稍后重试');
        if (!(e instanceof ApiProblem))
            console.error('ClearTrace request failed', e instanceof Error ? e.message : 'unknown');
        return Response.json({ error: { code: p.code, message: p.message, ...(p.details ? { details: p.details } : {}) } }, { status: p.status, headers: { 'Cache-Control': 'no-store' } });
    }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;

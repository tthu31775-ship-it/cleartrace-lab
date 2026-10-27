import { z, ZodError } from 'zod';
import openapi from '@/docs/openapi.json';
import { authenticate, authorize, clearSessionCookie, createSession, ensureAdminAccount, hashToken, login, revokeMemberSessions, revokeSession, sessionCookie, setMemberPassword, verifyOrigin, verifyOwnPassword } from '@/lib/server/auth';
import { account, ApiProblem, audit, database, dataset, first, now, rows, runtime, uuid } from '@/lib/server/db';
import { ensureSeed } from '@/lib/server/seed';
import { ensureCoordinationSeed, exportLeads, getEvent, getEventGraph, getLead, leadsOfAccount, listEvents, listLeads, parseLeadQuery, reviewLead } from '@/lib/server/coordination';
import { douyinStatus, importDouyinSample, listComments, listPredictions, modelStatus, screenComments } from '@/lib/server/screening';
import { scanCoordinationEvent } from '@/lib/server/scan';
import { exportBackup, exportSchema, exportSummary, exportTable, EXPORT_KEYS } from '@/lib/server/exports';
import { ensureDatasetKinds, getDatasetDetail } from '@/lib/server/dataset-detail';
import { predictComment, predictCommentBatch, WB01_MAX_BATCH, WB01_MAX_LENGTH, wb01ModelInfo } from '@/lib/core/wb01';
import { bootstrap, createTask, exportTask, getAccount, getAccounts, getDatasets, getIntegrations, getLogs, getMembers, getTask, getTasks, graphOf, importDataset, runTask } from '@/lib/server/service';
import { ImportError } from '@/lib/core/import';
import type { User } from '@/lib/contracts';
export const dynamic = 'force-dynamic';
const text = z.string().trim().min(1).max(120);
const importSchema = z.object({ name: text, source: z.string().trim().min(1).max(200).default('团队导入'), format: z.enum(['csv', 'json']), content: z.string().min(1).max(5000000), dryRun: z.boolean().default(true), description: z.string().max(1000).optional() });
const taskSchema = z.object({ name: text, datasetId: z.string().min(1).max(100), modelId: z.enum(['baseline-v1', 'external']).default('baseline-v1'), threshold: z.number().int().min(30).max(95).default(65) });
const roles = z.enum(['editor', 'reviewer', 'viewer']);
const memberSchema = z.object({ name: text, email: z.string().email().max(200).transform(x => x.toLowerCase()), role: roles, password: z.string().min(1).max(200).optional() });
const reviewSchema = z.object({ status: z.enum(['confirmed', 'dismissed', 'pending']), note: z.string().trim().min(1, '请填写复核依据').max(1000) });
const leadReviewSchema = z.object({ status: z.enum(['pending', 'following', 'confirmed', 'dismissed']), note: z.string().trim().min(1, '请填写复核依据').max(1000) });
const screeningSchema = z.object({ runId: z.string().trim().max(120).optional(), items: z.array(z.object({ content: z.string().max(4000), commentId: z.string().trim().max(200).optional(), accountId: z.string().trim().max(200).optional(), authorName: z.string().trim().max(120).optional(), namespace: z.string().trim().max(40).optional() })).min(1).max(200) });
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
        if (method === 'GET' && key === 'openapi')            return Response.json(openapi, { headers: { 'Cache-Control': 'public, max-age=300' } });
        const db = database();
        // 账号登录:不依赖任何上游身份代理,由本服务校验密码并签发服务端会话。
        if (method === 'POST' && key === 'auth/login') {
            verifyOrigin(request);
            await ensureAdminAccount(db);
            const body = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) }).parse(await readBody(request));
            const result = await login(db, body.email, body.password, request);
            await audit(db, result.user, '账号登录', result.user.email);
            return Response.json({ data: result.user }, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': result.cookie } });
        }
        if (method === 'POST' && key === 'auth/logout') {
            verifyOrigin(request);
            await revokeSession(db, request);
            return Response.json({ data: { signedOut: true } }, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': clearSessionCookie(request) } });
        }
        const user = await authenticate(request, db);
        if (method !== 'GET' && method !== 'HEAD')
            verifyOrigin(request);
        if (method === 'POST' && key === 'auth/password') {
            const body = z.object({ currentPassword: z.string().min(1).max(200), nextPassword: z.string().min(1).max(200) }).parse(await readBody(request));
            if (!user.email || !await verifyOwnPassword(db, user.email, body.currentPassword))
                throw new ApiProblem(401, 'invalid_credentials', '当前密码不正确');
            await setMemberPassword(db, user.id, body.nextPassword);
            await revokeMemberSessions(db, user.id);
            const fresh = await createSession(db, user.id, request);
            await audit(db, user, '修改密码', user.email);
            return Response.json({ data: { updated: true } }, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': sessionCookie(fresh.token, request, fresh.ttl) } });
        }
        const seedFlag = (runtime().SEED_DEMO_DATA || 'true').toLowerCase();
        if (seedFlag !== 'false' && seedFlag !== '0') {
            await ensureSeed(db);
            await ensureCoordinationSeed(db);
            await ensureDatasetKinds(db);
        }
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
            if (method === 'GET') {
                const detail = await getDatasetDetail(db, path[1]);
                if (!detail)
                    throw new ApiProblem(404, 'dataset_not_found', '数据集不存在');
                return json(detail);
            }
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
        // ---- WB01 交付包的原始契约(便于算法组的客户端/脚本直接对接) ----
        const wb01Ok = (data: unknown) => Response.json({ code: 0, data }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
        const wb01Fail = (code: number, msg: string) => Response.json({ code, msg }, { status: code, headers: { 'Cache-Control': 'no-store' } });
        if (method === 'GET' && (key === 'water-comment/model_info' || key === 'model/info')) {
            const info = wb01ModelInfo() as Record<string, unknown> & { model_version: string; threshold: number };
            return wb01Ok({ ...info, model_version: info.model_version, threshold: info.threshold });
        }
        if (method === 'POST' && key === 'water-comment/predict') {
            const body = z.object({ content: z.string(), comment_id: z.string().trim().max(200).optional() }).safeParse(await readBody(request));
            if (!body.success)
                return wb01Fail(400, 'content 不能为空');
            const content = body.data.content;
            if (!content.trim())
                return wb01Fail(400, 'content 不能为空');
            if (content.length > WB01_MAX_LENGTH)
                return wb01Fail(400, `content 太长(最多 ${WB01_MAX_LENGTH} 字)`);
            const started = performance.now();
            const prediction = predictComment(content, body.data.comment_id);
            return wb01Ok({
                comment_id: prediction.comment_id,
                probability: prediction.probability,
                label: prediction.label,
                risk_level: prediction.risk_level,
                threshold: prediction.threshold,
                confidence: prediction.confidence,
                model_version: prediction.model_version,
                evidence: prediction.evidence,
                latency_ms: Math.round((performance.now() - started) * 100) / 100,
            });
        }
        if (method === 'POST' && key === 'water-comment/predict_batch') {
            const body = z.object({ items: z.array(z.object({ content: z.string().optional(), comment_id: z.string().trim().max(200).optional() })).min(1).max(WB01_MAX_BATCH) }).safeParse(await readBody(request));
            if (!body.success)
                return wb01Fail(400, `items 必须是非空数组,单次最多 ${WB01_MAX_BATCH} 条`);
            const started = performance.now();
            const results = predictCommentBatch(body.data.items).map(item => ('error' in item
                ? { comment_id: item.comment_id, error: item.error }
                : {
                    comment_id: item.comment_id,
                    probability: item.probability,
                    label: item.label,
                    risk_level: item.risk_level,
                    threshold: item.threshold,
                    confidence: item.confidence,
                    model_version: item.model_version,
                    evidence: item.evidence,
                }));
            return wb01Ok({ items: results, latency_ms: Math.round((performance.now() - started) * 100) / 100 });
        }
        // ---- 事件协同在线扫描 ----
        if (method === 'POST' && key === 'coordination/scan') {
            authorize(user, ['admin', 'editor', 'reviewer']);
            const body = z.object({
                eventId: z.string().trim().min(1).max(200),
                datasetId: z.string().trim().max(200).optional().nullable(),
                comments: z.array(z.any()).min(1).max(5000),
                parameters: z.object({ minAccounts: z.number().optional(), windowMinutes: z.number().optional(), similarityThreshold: z.number().optional() }).partial().optional(),
            }).parse(await readBody(request));
            return json(await scanCoordinationEvent(db, user, body), 201);
        }
        // ---- 数据导出 ----
        if (method === 'GET' && key === 'exports/summary')
            return json(await exportSummary(db));
        if (method === 'GET' && key === 'exports/backup') {
            authorize(user, ['admin']);
            return await exportBackup(db, user);
        }
        if (method === 'GET' && key === 'exports/schema')
            return await exportSchema(db, user);
        if (path[0] === 'exports' && path.length === 2 && method === 'GET') {
            if (!EXPORT_KEYS.includes(path[1]))
                throw new ApiProblem(404, 'export_unknown', '未知的导出对象');
            return await exportTable(db, user, path[1], params.get('format') === 'json' ? 'json' : 'csv', params.get('headers') !== 'raw');
        }
        // ---- 协同线索 / 事件图谱(预计算批次) ----
        if (method === 'GET' && key === 'leads')
            return json(await listLeads(db, parseLeadQuery(params)));
        if (method === 'GET' && key === 'leads/export')
            return await exportLeads(db, user, parseLeadQuery(params));
        if (method === 'GET' && key === 'leads/account')
            return json(await leadsOfAccount(db, String(params.get('key') || ''), String(params.get('namespace') || 'coordination')));
        if (path[0] === 'leads' && path.length === 2 && method === 'GET')
            return json(await getLead(db, path[1]));
        if (path[0] === 'leads' && path.length === 3 && path[2] === 'review' && method === 'POST') {
            authorize(user, ['admin', 'editor', 'reviewer']);
            const body = leadReviewSchema.parse(await readBody(request));
            return json(await reviewLead(db, user, path[1], body.status, body.note));
        }
        if (method === 'GET' && key === 'events')
            return json(await listEvents(db, {
                page: Math.max(1, Number(params.get('page') || 1) || 1),
                pageSize: Math.min(100, Math.max(5, Number(params.get('pageSize') || 20) || 20)),
                namespace: (params.get('namespace') || '').trim(),
                q: (params.get('q') || '').trim().slice(0, 120),
                batch: (params.get('batch') || '').trim(),
            }));
        if (path[0] === 'events' && path.length === 2 && method === 'GET')
            return json(await getEvent(db, path[1]));
        if (path[0] === 'events' && path.length === 3 && path[2] === 'graph' && method === 'GET')
            return json(await getEventGraph(db, path[1]));
        // ---- 评论与文本筛查 ----
        if (method === 'GET' && key === 'comments')
            return json(await listComments(db, params));
        if (method === 'GET' && key === 'screening/predictions')
            return json(await listPredictions(db, params));
        if (method === 'POST' && key === 'screening/comments') {
            authorize(user, ['admin', 'editor', 'reviewer']);
            const body = screeningSchema.parse(await readBody(request));
            return json(await screenComments(db, user, body.items, body.runId), 201);
        }
        if (method === 'GET' && key === 'models/status')
            return json(await modelStatus(db));
        if (method === 'GET' && key === 'imports/douyin')
            return json(await douyinStatus(db));
        if (method === 'POST' && key === 'imports/douyin') {
            authorize(user, ['admin', 'editor']);
            return json(await importDouyinSample(db, user), 201);
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
                const saved = (await getMembers(db)).find(m => m.email === body.email);
                if (body.password && saved) {
                    await setMemberPassword(db, saved.id, body.password);
                    await revokeMemberSessions(db, saved.id);
                }
                return json((await getMembers(db)).find(m => m.email === body.email), 201);
            }
            if (method === 'POST' && path.length === 3 && path[2] === 'password') {
                const body = z.object({ password: z.string().min(1).max(200) }).parse(await readBody(request));
                const existing = await first(db, 'SELECT * FROM members WHERE id=?', path[1]);
                if (!existing)
                    throw new ApiProblem(404, 'member_not_found', '成员不存在');
                await setMemberPassword(db, String(existing.id), body.password);
                await revokeMemberSessions(db, String(existing.id));
                await audit(db, user, '设置成员密码', String(existing.email));
                return json((await getMembers(db)).find(m => m.id === String(existing.id)));
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
        // 提前拒绝(如来源校验、鉴权失败)时请求体可能还没被读取。
        // 不显式取消会让运行时一直等待上行数据,后续请求会被拖住。
        if (request.body && !request.bodyUsed) {
            try {
                // 读完丢弃:只 cancel 不排空,运行时仍会等上行数据,连接被占住。
                await request.text();
            }
            catch {
                try {
                    await request.body?.cancel();
                }
                catch { /* 已关闭 */ }
            }
        }
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

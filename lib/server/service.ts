import type { Account, Bootstrap, Distribution, GraphData, Integration, User } from '../contracts';
import { ApiProblem, account, accountColumns, audit, database, dataset, first, insertMany, log, member, now, resultColumns, rows, runtime, task, uuid } from './db';
import { infer } from './model';
import { validateImport } from '../core/import';
import { csvCell } from '../core/detection';
import type { z } from 'zod';
export async function getDatasets(db: D1Database) { return (await rows(db, 'SELECT * FROM datasets ORDER BY created_at DESC')).map(dataset); }
export async function getTasks(db: D1Database) { return (await rows(db, 'SELECT t.*,d.name AS dataset_name FROM tasks t JOIN datasets d ON d.id=t.dataset_id ORDER BY t.created_at DESC LIMIT 200')).map(task); }
export async function getTask(db: D1Database, id: string) { const r = await first(db, 'SELECT t.*,d.name AS dataset_name FROM tasks t JOIN datasets d ON d.id=t.dataset_id WHERE t.id=?', id); if (!r)
    throw new ApiProblem(404, 'task_not_found', '任务不存在'); return task(r); }
export async function getAccounts(db: D1Database, params?: URLSearchParams) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (params?.get('datasetId')) {
        clauses.push('dataset_id=?');
        values.push(params.get('datasetId'));
    }
    const risk = params?.get('riskLevel') || params?.get('risk');
    if (risk && risk !== 'all') {
        clauses.push('risk_level=?');
        values.push(risk);
    }
    const review = params?.get('reviewStatus') || params?.get('status');
    if (review && review !== 'all') {
        clauses.push('review_status=?');
        values.push(review);
    }
    if (params?.get('q')) {
        clauses.push('(account_id LIKE ? ESCAPE \'\\\' OR display_name LIKE ? ESCAPE \'\\\')');
        const q = '%' + params.get('q')!.replace(/[\\%_]/g, '\\$&') + '%';
        values.push(q, q);
    }
    const limit = Math.max(1, Math.min(5000, Number(params?.get('limit')) || 1000));
    return (await rows(db, `SELECT * FROM accounts ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''} ORDER BY risk_score DESC,created_at DESC LIMIT ?`, ...values, limit)).map(account);
}
export async function getAccount(db: D1Database, id: string) { const r = await first(db, 'SELECT * FROM accounts WHERE id=?', id); if (!r)
    throw new ApiProblem(404, 'account_not_found', '账号不存在'); return account(r); }
export async function getMembers(db: D1Database) { return (await rows(db, 'SELECT * FROM members ORDER BY created_at')).map(member); }
export async function getLogs(db: D1Database) { return (await rows(db, 'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 150')).map(log); }
export async function getIntegrations(db: D1Database): Promise<Integration[]> {
    const setting = await first(db, "SELECT value FROM settings WHERE key='external_enabled'");
    const enabled = setting?.value !== 'false';
    const configured = !!runtime().MODEL_SERVICE_URL && enabled;
    return [{ id: 'data-import', name: '数据导入接口', type: 'data', status: 'ready', description: '支持 CSV / JSON 校验、去重与版本入库', endpoint: '/api/v1/datasets/import', version: 'v1' }, { id: 'baseline-v1', name: '行为规则基线', type: 'model', status: 'ready', description: '基于重复比例、集中发布、频率与间隔的可解释规则', endpoint: '/api/v1/tasks', version: 'rules-1.0.0' }, { id: 'external', name: '算法组模型服务', type: 'model', status: configured ? 'ready' : 'pending', description: configured ? '已配置服务端算法地址；创建任务可检验实际调用' : '等待配置 MODEL_SERVICE_URL / MODEL_API_KEY', endpoint: '服务端 HTTPS 适配器', version: 'v1' }, { id: 'openapi', name: '开放接口协议', type: 'api', status: 'ready', description: '稳定的 JSON API 与服务令牌鉴权', endpoint: '/api/v1/openapi', version: 'OpenAPI 3.1' }];
}
export function graphOf(accounts: Account[], limit = 60): GraphData {
    const selected = accounts.slice(0, Math.min(100, Math.max(5, limit)));
    const index = new Map(selected.map(a => [`${a.datasetId}:${a.accountId}`, a.id]));
    const edges: GraphData['edges'] = [];
    const seen = new Set<string>();
    for (const a of selected)
        for (const related of a.relatedIds) {
            const target = index.get(`${a.datasetId}:${related}`);
            if (target && target !== a.id) {
                const key = [a.id, target].sort().join(':');
                if (!seen.has(key)) {
                    seen.add(key);
                    edges.push({ source: a.id, target, weight: 1, type: '样本关联' });
                }
            }
        }
    return { nodes: selected.map(a => ({ id: a.id, label: a.displayName, accountId: a.accountId, riskLevel: a.riskLevel, riskScore: a.riskScore })), edges, truncated: accounts.length > selected.length, totalNodes: accounts.length };
}
export async function bootstrap(db: D1Database, user: User): Promise<Bootstrap> {
    const sevenDaysAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const [datasets, tasks, accounts, logs, integrations, members, accountStats, taskStats, trendRows, riskRows] = await Promise.all([
        getDatasets(db), getTasks(db), getAccounts(db, new URLSearchParams({ limit: '5000' })), getLogs(db), getIntegrations(db), user.role === 'admin' ? getMembers(db) : Promise.resolve([]),
        first(db, "SELECT COUNT(*) AS total,SUM(CASE WHEN review_status='pending' THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN risk_level='high' THEN 1 ELSE 0 END) AS high,SUM(CASE WHEN review_status IN ('confirmed','dismissed') THEN 1 ELSE 0 END) AS reviewed FROM accounts"),
        first(db, "SELECT COUNT(*) AS total,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN status IN ('queued','running') THEN 1 ELSE 0 END) AS running FROM tasks"),
        rows(db, "SELECT substr(created_at,1,10) AS date,COUNT(*) AS tasks,SUM(processed) AS scanned,SUM(suspected_count) AS suspected FROM tasks WHERE status='completed' AND created_at>=? GROUP BY substr(created_at,1,10)", sevenDaysAgo),
        rows(db, 'SELECT risk_level,COUNT(*) AS count FROM accounts GROUP BY risk_level')
    ]);
    const stats = { totalAccounts: Number(accountStats?.total || 0), completedTasks: Number(taskStats?.completed || 0), pendingReviews: Number(accountStats?.pending || 0), totalDatasets: datasets.length, highRiskAccounts: Number(accountStats?.high || 0), runningTasks: Number(taskStats?.running || 0), reviewedAccounts: Number(accountStats?.reviewed || 0), totalTasks: Number(taskStats?.total || 0) };
    const trend = Array.from({ length: 7 }, (_, i) => { const date = new Date(Date.now() - (6 - i) * 86400000).toISOString().slice(0, 10); const r = trendRows.find(x => x.date === date); return { date, scanned: Number(r?.scanned || 0), suspected: Number(r?.suspected || 0), tasks: Number(r?.tasks || 0) }; });
    const distribution: Distribution[] = [{ name: '低风险', key: 'low', value: 0, color: '#16a38d' }, { name: '候选异常', key: 'high', value: 0, color: '#ef7b64' }, { name: '待关注', key: 'medium', value: 0, color: '#e5b651' }, { name: '未检测', key: 'unscored', value: 0, color: '#b2bec9' }];
    for (const item of distribution)
        item.value = Number(riskRows.find(x => x.risk_level === item.key)?.count || 0);
    return { user, workspace: { name: '研究工作空间', version: '1.0.0', demo: datasets.some(d => d.demo) }, stats, trend, distribution, datasets, tasks, accounts, logs, integrations, members, graph: graphOf(accounts) };
}
export interface ImportBody {
    name: string;
    source: string;
    format: 'csv' | 'json';
    content: string;
    dryRun: boolean;
    description?: string;
}
export async function importDataset(db: D1Database, user: User, body: ImportBody) {
    const parsed = validateImport(body.content, body.format);
    const summary = { valid: parsed.valid, rows: parsed.rows, accepted: parsed.records.length, duplicateCount: parsed.duplicateCount, errors: parsed.errors, preview: parsed.records.slice(0, 5) };
    if (body.dryRun)
        return summary;
    if (!parsed.valid)
        throw new ApiProblem(400, 'import_validation_failed', '数据校验未通过，请修正错误后再导入', { errors: parsed.errors });
    const previous = await first(db, 'SELECT COUNT(*) AS count FROM datasets WHERE name=? AND demo=0', body.name);
    const version = `v${Number(previous?.count || 0) + 1}.0`;
    const id = uuid('dataset');
    const stamp = now();
    const statements: D1PreparedStatement[] = [db.prepare('INSERT INTO datasets(id,name,source,format,version,description,record_count,demo,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id, body.name, body.source, body.format, version, body.description || '', parsed.records.length, 0, stamp, user.id)];
    const accountValues = parsed.records.map(r => { const { accountId, displayName, platform, relatedIds, ...features } = r; return [uuid('account'), id, accountId, displayName, platform, JSON.stringify(features), JSON.stringify(relatedIds), null, 'unscored', 'unreviewed', '[]', null, 0, stamp]; });
    statements.push(...insertMany(db, 'accounts', accountColumns, accountValues));
    await db.batch(statements);
    await audit(db, user, '导入数据集', body.name, `导入 ${parsed.records.length} 条，去重 ${parsed.duplicateCount} 条`);
    return { ...summary, dataset: dataset((await first(db, 'SELECT * FROM datasets WHERE id=?', id))!) };
}
export async function createTask(db: D1Database, user: User, body: {
    name: string;
    datasetId: string;
    modelId: string;
    threshold: number;
}) {
    const d = await first(db, 'SELECT * FROM datasets WHERE id=?', body.datasetId);
    if (!d)
        throw new ApiProblem(404, 'dataset_not_found', '选择的数据集不存在');
    if (body.modelId === 'external' && !(await getIntegrations(db)).find(i => i.id === 'external' && i.status === 'ready'))
        throw new ApiProblem(503, 'model_not_configured', '算法组模型尚未接入，请使用行为规则基线或配置模型服务');
    const id = uuid('task');
    await db.prepare('INSERT INTO tasks(id,name,dataset_id,model_id,threshold,status,total,processed,suspected_count,attempt,created_at,created_by,demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id, body.name, body.datasetId, body.modelId, body.threshold, 'queued', d.record_count, 0, 0, 0, now(), user.id, 0).run();
    await audit(db, user, '创建摸排任务', body.name, `模型 ${body.modelId}；阈值 ${body.threshold}`);
    return getTask(db, id);
}
export async function runTask(db: D1Database, user: User, id: string) {
    const current = await getTask(db, id);
    if (current.status === 'completed')
        return current;
    if (current.attempt >= 5)
        throw new ApiProblem(409, 'retry_limit', '已达 5 次执行上限，请检查配置后新建任务');
    const stamp = now();
    const stale = new Date(Date.now() - 5 * 60000).toISOString();
    const claim = await db.prepare("UPDATE tasks SET status='running',started_at=?,completed_at=NULL,error=NULL,processed=0,attempt=attempt+1 WHERE id=? AND (status IN ('queued','failed') OR (status='running' AND started_at<?))").bind(stamp, id, stale).run();
    if (!claim.meta.changes)
        throw new ApiProblem(409, 'task_locked', '任务正在执行或已取消，请稍后刷新');
    try {
        if (current.modelId === 'external' && !(await getIntegrations(db)).find(i => i.id === 'external' && i.status === 'ready'))
            throw new ApiProblem(503, 'model_disabled', '外部模型未配置或已停用');
        const accounts = await getAccounts(db, new URLSearchParams({ datasetId: current.datasetId, limit: '1000' }));
        if (accounts.length === 0)
            throw new ApiProblem(409, 'empty_dataset', '数据集没有可检测账号');
        const results = await infer(accounts, id, current.modelId, current.threshold);
        const byAccount = new Map(accounts.map(a => [a.accountId, a]));
        const completed = now();
        const values = results.map(r => [uuid('result'), id, byAccount.get(r.accountId)!.id, r.score, r.riskLevel, JSON.stringify(r.reasons), r.modelVersion, completed]);
        const statements: D1PreparedStatement[] = [db.prepare('DELETE FROM results WHERE task_id=?').bind(id), ...insertMany(db, 'results', resultColumns, values)];
        statements.push(db.prepare(`UPDATE accounts SET review_status=CASE WHEN risk_score IS (SELECT score FROM results WHERE task_id=? AND account_id=accounts.id) AND reasons=(SELECT reasons FROM results WHERE task_id=? AND account_id=accounts.id) AND risk_level=(SELECT risk_level FROM results WHERE task_id=? AND account_id=accounts.id) AND model_version=(SELECT model_version FROM results WHERE task_id=? AND account_id=accounts.id) AND review_status IN ('confirmed','dismissed') THEN review_status WHEN (SELECT risk_level FROM results WHERE task_id=? AND account_id=accounts.id)='low' THEN 'unreviewed' ELSE 'pending' END, risk_score=(SELECT score FROM results WHERE task_id=? AND account_id=accounts.id),risk_level=(SELECT risk_level FROM results WHERE task_id=? AND account_id=accounts.id),reasons=(SELECT reasons FROM results WHERE task_id=? AND account_id=accounts.id),model_version=(SELECT model_version FROM results WHERE task_id=? AND account_id=accounts.id) WHERE dataset_id=?`).bind(id, id, id, id, id, id, id, id, id, current.datasetId));
        const suspected = results.filter(r => r.riskLevel !== 'low').length;
        statements.push(db.prepare("UPDATE tasks SET status='completed',processed=?,total=?,suspected_count=?,completed_at=? WHERE id=?").bind(accounts.length, accounts.length, suspected, completed, id));
        await db.batch(statements);
        await audit(db, user, '执行摸排任务', current.name, `完成 ${accounts.length} 个账号，${suspected} 个进入候选或关注范围`);
        return getTask(db, id);
    }
    catch (e) {
        const problem = e instanceof ApiProblem ? e : new ApiProblem(500, 'task_failed', '任务执行失败，请查看日志并重试');
        await db.prepare("UPDATE tasks SET status='failed',error=?,completed_at=? WHERE id=?").bind(problem.message, now(), id).run();
        await audit(db, user, '执行摸排任务', current.name, problem.message, 'error');
        throw problem;
    }
}
export async function exportTask(db: D1Database, id: string) {
    const t = await getTask(db, id);
    if (t.status !== 'completed')
        throw new ApiProblem(409, 'task_not_completed', '任务完成后才能导出结果');
    const result = await rows(db, 'SELECT a.account_id,a.display_name,a.platform,r.score,r.risk_level,r.reasons,r.model_version,a.review_status FROM results r JOIN accounts a ON a.id=r.account_id WHERE r.task_id=? ORDER BY r.score DESC', id);
    const header = ['account_id', 'display_name', 'platform', 'risk_score', 'risk_level', 'reasons', 'model_version', 'review_status'];
    const lines = result.map(r => [r.account_id, r.display_name, r.platform, r.score, r.risk_level, JSON.parse(String(r.reasons)).join('；'), r.model_version, r.review_status].map(csvCell).join(','));
    return new Response('\uFEFF' + [header.join(','), ...lines].join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="cleartrace-${id}.csv"`, 'Cache-Control': 'no-store' } });
}

// 数据导出中心:业务表 → CSV / JSON,以及全库 JSON 备份与建表 DDL。
// 导出行为写审计日志;原始评论、账号键等敏感字段只在登录后可见。

import type { ExportSummary, User } from '../contracts';
import { ApiProblem, audit, dataset, now, rows, type Row } from './db';

const MAX_ROWS = 200000;

const beijing = (unix: number | null | undefined) => {
    if (unix === null || unix === undefined)
        return '';
    return new Date((Number(unix) + 8 * 3600) * 1000).toISOString().replace('T', ' ').slice(0, 19);
};

const iso = (value: unknown) => (value === null || value === undefined ? '' : String(value));

interface Spec {
    label: string;
    description: string;
    sensitive: boolean;
    sql: string;
    columns: Array<[string, string]>;
    timeColumns?: Record<string, 'unix' | 'iso'>;
}

const SPECS: Record<string, Spec> = {
    leads: {
        label: '协同线索',
        description: '803 组预计算线索 + 在线扫描产生的线索;含运行批次、来源定位、复核结论与排序分口径。',
        sensitive: false,
        sql: `SELECT id, run_id, event_id, source_namespace, event_line, lead_number, representative_text,
                account_count, comment_count, start_time, end_time, min_similarity, score, score_type,
                calibrated, review_status, review_note, reviewer_name, reviewed_at, created_at
              FROM coordination_leads ORDER BY run_id, lead_number`,
        columns: [['id', '线索ID'], ['run_id', '运行批次'], ['event_id', '事件ID'], ['source_namespace', '来源命名空间'],
            ['event_line', '事件行号'], ['lead_number', '线索序号'], ['representative_text', '代表评论'],
            ['account_count', '账号数'], ['comment_count', '评论数'], ['start_time', '开始时间(北京)'],
            ['end_time', '结束时间(北京)'], ['min_similarity', '最小文本相似度'], ['score', '排序分'],
            ['score_type', '排序分口径'], ['calibrated', '是否校准概率'], ['review_status', '复核状态'],
            ['review_note', '复核依据'], ['reviewer_name', '复核人'], ['reviewed_at', '复核时间'], ['created_at', '入库时间']],
        timeColumns: { start_time: 'unix', end_time: 'unix' },
    },
    comments: {
        label: '评论明细',
        description: '抖音小样本与文本筛查入库的评论;含来源键、时间精度、点赞是否已知。',
        sensitive: true,
        sql: `SELECT id, dataset_id, event_id, platform, source_namespace, source_comment_key, source_account_key,
                author_name, content, publish_time, publish_time_iso, time_precision, timezone, reply_to_key,
                like_count, like_known, ip_region, source_locator, import_batch, created_at
              FROM comments ORDER BY created_at DESC, id`,
        columns: [['id', '评论ID'], ['dataset_id', '数据集'], ['event_id', '事件/作品'], ['platform', '平台'],
            ['source_namespace', '来源命名空间'], ['source_comment_key', '来源评论键'], ['source_account_key', '来源账号键'],
            ['author_name', '昵称'], ['content', '评论原文'], ['publish_time', '发布时间(Unix秒)'],
            ['publish_time_iso', '发布时间(ISO)'], ['time_precision', '时间精度'], ['timezone', '时区'],
            ['reply_to_key', '回复目标'], ['like_count', '点赞数'], ['like_known', '点赞是否采集'],
            ['ip_region', 'IP属地(平台公开字段)'], ['source_locator', '来源定位'], ['import_batch', '导入批次'], ['created_at', '入库时间']],
    },
    predictions: {
        label: '文本筛查结果',
        description: 'WB01 逐条结果;失败条目分数留空,status=error。',
        sensitive: true,
        sql: `SELECT p.id, p.run_id, p.comment_id, c.source_namespace, c.source_comment_key, c.content,
                p.model_version, p.raw_score, p.threshold, p.label, p.risk_level, p.confidence, p.evidence,
                p.status, p.error, p.created_by, p.created_at
              FROM comment_predictions p LEFT JOIN comments c ON c.id = p.comment_id
              ORDER BY p.created_at DESC, p.id`,
        columns: [['id', '结果ID'], ['run_id', '运行批次'], ['comment_id', '评论ID'], ['source_namespace', '来源命名空间'],
            ['source_comment_key', '来源评论键'], ['content', '评论原文'], ['model_version', '模型版本'],
            ['raw_score', '文本筛查分数'], ['threshold', '阈值'], ['label', '标签'], ['risk_level', '风险等级'],
            ['confidence', '文本长度可信度'], ['evidence', '证据计数'], ['status', '状态'], ['error', '错误原因'],
            ['created_by', '操作人'], ['created_at', '时间']],
    },
    events: {
        label: '事件 / 作品',
        description: '预计算事件、抖音作品与在线扫描事件;图谱本身走 /events/:id/graph。',
        sensitive: false,
        sql: `SELECT id, dataset_id, source_namespace, source_file, event_line, event_ref, native_work_id, title,
                lead_count, node_count, reply_count, max_accounts, lead_node_count, time_min, time_max,
                time_precision, import_batch, created_at FROM events ORDER BY import_batch, event_line`,
        columns: [['id', '事件ID'], ['dataset_id', '数据集'], ['source_namespace', '来源命名空间'], ['source_file', '来源文件'],
            ['event_line', '行号/序号'], ['event_ref', '原始事件标识'], ['native_work_id', '平台作品ID'], ['title', '标题'],
            ['lead_count', '线索组数'], ['node_count', '节点数'], ['reply_count', '回复边数'], ['max_accounts', '最大账号数'],
            ['lead_node_count', '线索相关节点'], ['time_min', '最早时间(北京)'], ['time_max', '最晚时间(北京)'],
            ['time_precision', '时间精度'], ['import_batch', '导入批次'], ['created_at', '入库时间']],
        timeColumns: { time_min: 'unix', time_max: 'unix' },
    },
    lead_members: {
        label: '线索成员',
        description: '每条线索下的来源账号及其评论数、相似度、是否代表评论作者。',
        sensitive: true,
        sql: `SELECT id, lead_id, member_key, account_namespace, comment_count, first_time, last_time, similarity, is_representative, created_at
              FROM coordination_lead_members ORDER BY lead_id, comment_count DESC`,
        columns: [['id', '记录ID'], ['lead_id', '线索ID'], ['member_key', '来源账号键'], ['account_namespace', '账号命名空间'],
            ['comment_count', '评论数'], ['first_time', '首次时间(北京)'], ['last_time', '最近时间(北京)'],
            ['similarity', '相似度'], ['is_representative', '代表评论作者'], ['created_at', '入库时间']],
        timeColumns: { first_time: 'unix', last_time: 'unix' },
    },
    graph_edges: {
        label: '图谱边',
        description: 'reply=原始回复关系(observed);similarity=文本相似推导(derived),两者不混用。',
        sensitive: false,
        sql: `SELECT id, event_id, run_id, lead_id, source_key, target_key, edge_type, origin, weight, created_at
              FROM graph_edges ORDER BY event_id, edge_type`,
        columns: [['id', '边ID'], ['event_id', '事件ID'], ['run_id', '运行批次'], ['lead_id', '线索ID'],
            ['source_key', '源节点'], ['target_key', '目标节点'], ['edge_type', '边类型'], ['origin', '来源性质'],
            ['weight', '权重/相似度'], ['created_at', '入库时间']],
    },
    accounts: {
        label: '账号研判',
        description: '工作台原有的账号级行为特征与规则基线结果,不是评论文本模型结果。',
        sensitive: true,
        sql: `SELECT id, dataset_id, account_id, display_name, platform, features, risk_score, risk_level,
                review_status, reasons, model_version, created_at FROM accounts ORDER BY risk_score DESC`,
        columns: [['id', '账号ID'], ['dataset_id', '数据集'], ['account_id', '来源账号'], ['display_name', '昵称'],
            ['platform', '平台'], ['features', '行为特征(JSON)'], ['risk_score', '规则分'], ['risk_level', '风险等级'],
            ['review_status', '复核状态'], ['reasons', '命中信号'], ['model_version', '模型版本'], ['created_at', '入库时间']],
    },
    datasets: {
        label: '数据集',
        description: '导入批次与版本。',
        sensitive: false,
        sql: `SELECT id, name, source, format, version, description, record_count, demo, created_at, created_by FROM datasets ORDER BY created_at`,
        columns: [['id', '数据集ID'], ['name', '名称'], ['source', '来源'], ['format', '格式'], ['version', '版本'],
            ['description', '说明'], ['record_count', '记录数'], ['demo', '是否示例'], ['created_at', '创建时间'], ['created_by', '创建人']],
    },
    tasks: {
        label: '摸排任务',
        description: '账号级识别任务的执行记录。',
        sensitive: false,
        sql: `SELECT id, name, dataset_id, model_id, threshold, status, total, processed, suspected_count, attempt,
                error, created_at, started_at, completed_at, created_by, demo FROM tasks ORDER BY created_at DESC`,
        columns: [['id', '任务ID'], ['name', '任务名'], ['dataset_id', '数据集'], ['model_id', '模型'], ['threshold', '阈值'],
            ['status', '状态'], ['total', '总数'], ['processed', '已处理'], ['suspected_count', '疑似数'], ['attempt', '尝试次数'],
            ['error', '错误'], ['created_at', '创建时间'], ['started_at', '开始时间'], ['completed_at', '完成时间'],
            ['created_by', '创建人'], ['demo', '是否示例']],
    },
    reviews: {
        label: '账号复核记录',
        description: '账号级人工复核历史(线索复核记录在 leads 表内)。',
        sensitive: true,
        sql: `SELECT id, account_id, status, note, reviewer_id, reviewer_name, created_at FROM reviews ORDER BY created_at DESC`,
        columns: [['id', '记录ID'], ['account_id', '账号ID'], ['status', '结论'], ['note', '依据'],
            ['reviewer_id', '复核人ID'], ['reviewer_name', '复核人'], ['created_at', '时间']],
    },
    audit_logs: {
        label: '操作日志',
        description: '登录、导入、任务、复核、导出等关键动作留痕。',
        sensitive: true,
        sql: `SELECT id, actor_id, actor, action, target, status, detail, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 20000`,
        columns: [['id', '日志ID'], ['actor_id', '操作人ID'], ['actor', '操作人'], ['action', '动作'], ['target', '对象'],
            ['status', '结果'], ['detail', '详情'], ['created_at', '时间']],
    },
    scans: {
        label: '扫描运行记录',
        description: '在线扫描的参数、保留数、跳过原因与耗时。',
        sensitive: false,
        sql: `SELECT key, value, updated_at FROM settings WHERE key LIKE 'scan_run_%' ORDER BY updated_at DESC`,
        columns: [['key', '运行键'], ['value', '运行参数(JSON)'], ['updated_at', '时间']],
    },
};

export const EXPORT_KEYS = Object.keys(SPECS);

/** 表级过滤:支持按数据集、批次、运行批次导出子集,供数据集页直接下载。 */
function filterOf(key: string, params: URLSearchParams): { where: string; args: unknown[] } | null {
    const datasetId = (params.get('datasetId') || '').trim();
    const runId = (params.get('runId') || '').trim();
    const namespace = (params.get('namespace') || '').trim();
    if (key === 'accounts' && datasetId)
        return { where: 'dataset_id = ?', args: [datasetId] };
    if (key === 'comments' && datasetId)
        return { where: 'dataset_id = ?', args: [datasetId] };
    if (key === 'comments' && namespace)
        return { where: 'source_namespace = ?', args: [namespace] };
    if (key === 'events' && datasetId)
        return { where: 'dataset_id = ?', args: [datasetId] };
    if (key === 'leads' && runId === 'scan')
        return { where: "run_id LIKE 'scan_%'", args: [] };
    if (key === 'leads' && runId)
        return { where: 'run_id = ?', args: [runId] };
    if (key === 'predictions' && runId)
        return { where: 'run_id = ?', args: [runId] };
    return null;
}

export async function exportSummary(db: D1Database): Promise<ExportSummary> {
    const tables = [];
    let databaseBytes = 0;
    for (const [key, spec] of Object.entries(SPECS)) {
        const count = await db.prepare(`SELECT COUNT(*) AS total FROM (${spec.sql})`).first<{ total: number }>();
        const total = Number(count?.total ?? 0);
        databaseBytes += total * 160;
        tables.push({ key, label: spec.label, rows: total, description: spec.description, sensitive: spec.sensitive });
    }
    const page = await db.prepare("SELECT COALESCE(SUM(pgsize),0) AS bytes FROM dbstat WHERE name NOT LIKE 'sqlite_%'").first<{ bytes: number }>().catch(() => null);
    if (page)
        databaseBytes = Number(page.bytes ?? databaseBytes);
    return {
        tables,
        databaseBytes,
        generatedAt: now(),
        notes: [
            'CSV 使用 UTF-8 BOM,Excel 可直接打开;时间是北京时间(整秒去掉毫秒)。',
            '线索、评论、筛查结果、账号键属于敏感数据,导出行为会写入操作日志。',
            '只有登录成员可以下载;接口令牌(api_tokens)也能调用,便于脚本化备份。',
            '全库备份是 JSON(便于二次处理);需要 SQLite 文件级备份请在服务器上直接拷贝 .wrangler/state。',
        ],
    };
}

const csvCell = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
};

function shape(spec: Spec, row: Row, withLabels: boolean) {
    const out: Record<string, unknown> = {};
    for (const [key, label] of spec.columns) {
        const raw = row[key];
        let value = raw;
        const kind = spec.timeColumns?.[key];
        if (kind === 'unix')
            value = beijing(raw as number);
        else if (kind === 'iso' && raw)
            value = new Date(String(raw)).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
        out[withLabels ? label : key] = value ?? '';
    }
    return out;
}

export async function exportTable(db: D1Database, user: User, key: string, format: 'csv' | 'json', withLabels = true, params = new URLSearchParams()) {
    const spec = SPECS[key];
    if (!spec)
        throw new ApiProblem(404, 'export_unknown', '未知的导出对象');
    const filter = filterOf(key, params);
    const sql = filter
        ? `SELECT * FROM (${spec.sql}) WHERE ${filter.where} LIMIT ${MAX_ROWS}`
        : `${spec.sql} LIMIT ${MAX_ROWS}`;
    const data = filter ? await rows(db, sql, ...filter.args) : await rows(db, sql);
    await audit(db, user, '导出数据', spec.label, `${data.length} 行;格式 ${format}`);
    const stamp = now().slice(0, 10);
    if (format === 'json') {
        const payload = data.map(row => shape(spec, row, false));
        return new Response(JSON.stringify({ table: key, label: spec.label, exportedAt: now(), rows: payload.length, items: payload }, null, 1), {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Disposition': `attachment; filename="cleartrace-${key}-${stamp}.json"`,
                'Cache-Control': 'no-store',
            },
        });
    }
    const shaped = data.map(row => shape(spec, row, withLabels));
    const headers = spec.columns.map(([key2, label]) => (withLabels ? label : key2));
    const lines = [headers.map(csvCell).join(',')];
    for (const row of shaped)
        lines.push(headers.map(header => csvCell(row[header])).join(','));
    void iso;
    return new Response('\uFEFF' + lines.join('\r\n'), {
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="cleartrace-${key}-${stamp}.csv"`,
            'Cache-Control': 'no-store',
        },
    });
}

/** 全库备份:所有业务表原样导出为 JSON。 */
export async function exportBackup(db: D1Database, user: User) {
    const tables: Record<string, unknown> = {};
    let total = 0;
    for (const [key, spec] of Object.entries(SPECS)) {
        const data = await rows(db, spec.sql);
        tables[key] = data.map(row => shape(spec, row, false));
        total += data.length;
    }
    await audit(db, user, '导出全库备份', '全部业务表', `${total} 行`);
    const stamp = now().replace(/[:.]/g, '-');
    return new Response(JSON.stringify({
        format: 'cleartrace-backup/1',
        exportedAt: now(),
        exportedBy: { id: user.id, name: user.name, role: user.role },
        note: 'JSON 备份用于二次处理与对账;文件级备份请直接拷贝 .wrangler/state/v3/d1 下的 sqlite。',
        tables,
    }), {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="cleartrace-backup-${stamp}.json"`,
            'Cache-Control': 'no-store',
        },
    });
}

/** 建表 DDL:直接从 sqlite_master 取,保证与实际库一致。 */
export async function exportSchema(db: D1Database, user: User) {
    const objects = await rows(db, "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type DESC, name");
    const body = objects.map(object => `${String(object.sql)};`).join('\n\n');
    await audit(db, user, '导出建表语句', 'schema.sql', `${objects.length} 个对象`);
    return new Response(`-- 清源 ClearTrace 建表语句(导出时间 ${now()})\n-- 引擎:SQLite / Cloudflare D1\n\n${body}\n`, {
        headers: {
            'Content-Type': 'application/sql; charset=utf-8',
            'Content-Disposition': 'attachment; filename="cleartrace-schema.sql"',
            'Cache-Control': 'no-store',
        },
    });
}

/** 数据集字典,供页面展示"哪些批次在库里"。 */
export async function datasetInventory(db: D1Database) {
    const items = await rows(db, "SELECT * FROM datasets ORDER BY created_at DESC");
    return items.map(dataset);
}

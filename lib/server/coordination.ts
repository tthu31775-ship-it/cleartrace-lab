// 协同线索与事件图谱:预计算批次(algorithm package)的入库、查询、复核与导出。
// 只读写业务库;不调用算法服务,不虚构边与分数。

import coordinationData from '../data/coordination.json';
import graphData from '../data/graphs.json';
import type { CoordinationEvent, CoordinationLead, EventDetail, GraphEdgeRecord, LeadDetail, LeadMember, LeadPage, LeadReviewStatus, LeadStats, User } from '../contracts';
import { ApiProblem, audit, first, insertMany, now, rows, type Row } from './db';

export const COORDINATION_BATCH = 'coordination-20261023';
const SEED_KEY = 'coordination_seed_version';
// 种子版本独立于批次号:批次号用于数据归属,版本号用于判断是否要补写新表。
const SEED_TAG = `${COORDINATION_BATCH}.2`;

interface SeedLead {
    id: string;
    eventId: string;
    sourceFile: string;
    eventLine: number;
    eventRef: string;
    accountCount: number;
    commentCount: number;
    startTime: number | null;
    endTime: number | null;
    minSimilarity: number | null;
    representative: string;
    sourceLeadId: number;
    similarityEdges: [string, string, number | null][];
    members: { uid: string; comments: number; first: number | null; last: number | null; rep?: boolean }[];
    comments: { uid: string; text: string; time: number | null; likes: number; node: string | null; replyTo: string | null }[];
}

interface SeedEvent {
    id: string;
    sourceFile: string;
    eventLine: number;
    eventRef: string;
    leadCount: number;
    nodeCount: number;
    replyCount: number;
    maxAccounts: number;
    leadNodeCount: number;
    timeMin: number | null;
    timeMax: number | null;
    graphPath: string;
    replyEdges: [string, string][];
}

const graphs = graphData as unknown as Record<string, unknown>;

const seed = coordinationData as unknown as {
    dataset: { name: string; version: string; sourceFile: string; generatedAt: string; leadCount: number; eventCount: number; summary: Record<string, unknown> };
    events: SeedEvent[];
    leads: SeedLead[];
};

export const COORDINATION_VERSION = seed.dataset.version;

function namespaceOf(sourceFile: string) {
    return sourceFile.replace(/_information\.jsonl$/, '').replace(/\.jsonl$/, '') || 'unknown';
}

/** 分片提交,避免单次 batch 语句过多。 */
async function runChunks(db: D1Database, statements: D1PreparedStatement[], size = 40) {
    for (let i = 0; i < statements.length; i += size) {
        await db.batch(statements.slice(i, i + size));
    }
}

/**
 * 把交付包里 803 条线索 / 173 个事件 / 成员 / 回复边 / 相似边写入业务库。
 * 幂等键:events(source_namespace,event_line)、leads(run_id,event_id,lead_number)、
 *        lead_members(lead_id,member_key)、graph_edges(event_id,type,source,target,lead_id)。
 * 重复执行只会补齐缺失行,不会翻倍。
 */
export async function ensureCoordinationSeed(db: D1Database) {
    const existing = await first(db, 'SELECT value FROM settings WHERE key=?', SEED_KEY);
    if (existing?.value === SEED_TAG)
        return false;
    const stamp = now();
    const statements: D1PreparedStatement[] = [];

    for (const event of seed.events) {
        statements.push(db.prepare(
            'INSERT OR IGNORE INTO events(id,dataset_id,source_namespace,source_file,event_line,event_ref,native_work_id,title,lead_count,node_count,reply_count,max_accounts,lead_node_count,time_min,time_max,time_precision,graph_path,graph_json,import_batch,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ).bind(
            event.id, null, namespaceOf(event.sourceFile), event.sourceFile, event.eventLine, event.eventRef, null,
            `${event.sourceFile}:${event.eventLine}`, event.leadCount, event.nodeCount, event.replyCount, event.maxAccounts,
            event.leadNodeCount, event.timeMin, event.timeMax, 'minute', event.graphPath,
            JSON.stringify(graphs[event.id] ?? { nodes: [], replyEdges: [], groups: [] }), COORDINATION_BATCH, stamp,
        ));
    }

    // 交付包里的线索评论同时写入 comments 表:原始评论只有节点定位,
    // source_comment_key 用「来源文件:行号:节点」保证在批次内唯一。
    const commentValues: unknown[][] = [];
    const commentStatus = await first(db, 'SELECT COUNT(*) AS total FROM comments WHERE source_namespace=?', 'coordination');
    if (Number(commentStatus?.total ?? 0) === 0) {
        for (const lead of seed.leads) {
            for (const comment of lead.comments) {
                if (!comment.node)
                    continue;
                const iso = comment.time === null || comment.time === undefined ? null : new Date(comment.time * 1000).toISOString();
                commentValues.push([
                    `comment_coordination_${lead.sourceFile.replace(/[^a-z_]/g, '')}_${lead.eventLine}_${comment.node}`,
                    lead.eventId, null, 'unknown', 'coordination',
                    `${lead.sourceFile}:${lead.eventLine}:${comment.node}`, comment.uid, 'coordination', '',
                    comment.text, comment.time ?? null, iso, 'minute', 'Asia/Shanghai',
                    comment.replyTo ?? null, comment.likes ?? 0, 1, null,
                    `${lead.sourceFile}:${lead.eventLine}#${comment.node}`, COORDINATION_BATCH, stamp,
                ]);
            }
        }
    }

    const leadValues: unknown[][] = [];
    const memberValues: unknown[][] = [];
    const edgeValues: unknown[][] = [];
    for (const lead of seed.leads) {
        const leadId = lead.id;
        leadValues.push([
            leadId, COORDINATION_BATCH, lead.eventId, namespaceOf(lead.sourceFile), lead.eventLine, lead.sourceLeadId,
            lead.representative, lead.accountCount, lead.commentCount, lead.startTime, lead.endTime, lead.minSimilarity,
            null, 'heuristic', 0, 'pending', '', null, null, null, null,
            JSON.stringify(lead.comments), JSON.stringify(lead.similarityEdges), stamp,
        ]);
        for (const member of lead.members) {
            memberValues.push([
                `${leadId}:${member.uid}`, leadId, member.uid, null, 'coordination',
                member.comments, member.first, member.last, null, member.rep ? 1 : 0, stamp,
            ]);
        }
        for (const [source, target, similarity] of lead.similarityEdges) {
            edgeValues.push([
                `edge_sim_${leadId}_${source}_${target}`, lead.eventId, COORDINATION_BATCH, leadId, source, target,
                'similarity', 'derived', similarity, stamp,
            ]);
        }
    }

    if (commentValues.length) {
        statements.push(db.prepare('INSERT OR IGNORE INTO datasets(id,name,source,format,version,description,record_count,demo,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)')
            .bind('dataset-coordination-20261023', '协同线索预计算批次', '算法包 coordination 输出', 'jsonl',
                COORDINATION_VERSION, '803 组线索 / 173 个事件 / 7355 条线索评论,来自算法包离线扫描输出;清洗口径为离线版(341 项短句词典未随包交付)。',
                seed.leads.reduce((sum, lead) => sum + lead.comments.length, 0), 0, stamp, 'algorithm-package'));
        statements.push(...insertMany(db, 'comments', [
            'id', 'event_id', 'dataset_id', 'platform', 'source_namespace', 'source_comment_key', 'source_account_key',
            'account_namespace', 'author_name', 'content', 'publish_time', 'publish_time_iso', 'time_precision',
            'timezone', 'reply_to_key', 'like_count', 'like_known', 'ip_region', 'source_locator', 'import_batch', 'created_at',
        ], commentValues, true));
    }
    statements.push(...insertMany(db, 'coordination_leads', [
        'id', 'run_id', 'event_id', 'source_namespace', 'event_line', 'lead_number', 'representative_text',
        'account_count', 'comment_count', 'start_time', 'end_time', 'min_similarity', 'score', 'score_type',
        'calibrated', 'review_status', 'review_note', 'reviewer_id', 'reviewer_name', 'reviewed_at',
        'reviewed_run_id', 'comments', 'similarity_edges', 'created_at',
    ], leadValues, true));
    statements.push(...insertMany(db, 'coordination_lead_members', [
        'id', 'lead_id', 'member_key', 'node_key', 'account_namespace', 'comment_count',
        'first_time', 'last_time', 'similarity', 'is_representative', 'created_at',
    ], memberValues, true));

    // 真实回复边:来自事件图谱 HTML 内嵌 eventData.replyEdges,只保留线索相关节点之间的边。
    // 与上面的相似边分开保存:reply = 原始回复关系(observed),similarity = 文本相似推导(derived)。
    for (const event of seed.events) {
        for (const [source, target] of event.replyEdges ?? []) {
            edgeValues.push([
                `edge_reply_${event.id}_${source}_${target}`, event.id, COORDINATION_BATCH, '',
                source, target, 'reply', 'observed', null, stamp,
            ]);
        }
    }
    statements.push(...insertMany(db, 'graph_edges', [
        'id', 'event_id', 'run_id', 'lead_id', 'source_key', 'target_key', 'edge_type', 'origin', 'weight', 'created_at',
    ], edgeValues, true));

    statements.push(db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(SEED_KEY, SEED_TAG, stamp));
    await runChunks(db, statements);
    return true;
}

function leadRow(r: Row): CoordinationLead {
    return {
        id: String(r.id),
        runId: String(r.run_id),
        eventId: String(r.event_id),
        eventRef: String(r.event_ref ?? ''),
        sourceFile: String(r.source_file ?? ''),
        sourceNamespace: String(r.source_namespace),
        leadNumber: Number(r.lead_number),
        representative: String(r.representative_text ?? ''),
        accountCount: Number(r.account_count),
        commentCount: Number(r.comment_count),
        startTime: r.start_time === null || r.start_time === undefined ? null : Number(r.start_time),
        endTime: r.end_time === null || r.end_time === undefined ? null : Number(r.end_time),
        minSimilarity: r.min_similarity === null || r.min_similarity === undefined ? null : Number(r.min_similarity),
        score: r.score === null || r.score === undefined ? null : Number(r.score),
        scoreType: String(r.score_type || 'heuristic'),
        calibrated: !!r.calibrated,
        reviewStatus: String(r.review_status || 'pending') as LeadReviewStatus,
        reviewNote: String(r.review_note || ''),
        reviewerName: r.reviewer_name ? String(r.reviewer_name) : null,
        reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
        createdAt: String(r.created_at),
    };
}

function eventRow(r: Row): CoordinationEvent {
    return {
        id: String(r.id),
        sourceFile: String(r.source_file),
        sourceNamespace: String(r.source_namespace),
        eventRef: String(r.event_ref),
        eventLine: Number(r.event_line),
        leadCount: Number(r.lead_count),
        nodeCount: Number(r.node_count),
        replyCount: Number(r.reply_count),
        maxAccounts: Number(r.max_accounts),
        leadNodeCount: Number(r.lead_node_count),
        timeMin: r.time_min === null ? null : Number(r.time_min),
        timeMax: r.time_max === null ? null : Number(r.time_max),
        graphPath: String(r.graph_path),
    };
}

const leadSelect = `SELECT l.*, e.event_ref AS event_ref, e.source_file AS source_file, e.node_count AS node_count,
    e.time_min AS time_min, e.time_max AS time_max, e.graph_path AS graph_path
    FROM coordination_leads l JOIN events e ON e.id = l.event_id`;

export async function getLeadStats(db: D1Database): Promise<LeadStats> {
    const summary = await first(db, `SELECT COUNT(*) AS leads, COUNT(DISTINCT event_id) AS events,
        COALESCE(SUM(comment_count),0) AS comments, COALESCE(MAX(account_count),0) AS maxAccounts FROM coordination_leads`);
    const accounts = await first(db, 'SELECT COUNT(*) AS total FROM coordination_lead_members');
    // 预计算批次与在线扫描分开计数:两者的清洗口径不同,不能混成一个数字。
    const precomputed = await first(db, `SELECT COUNT(*) AS leads, COUNT(DISTINCT event_id) AS events,
        COALESCE(SUM(comment_count),0) AS comments FROM coordination_leads WHERE run_id=?`, COORDINATION_BATCH);
    const precomputedAccounts = await first(db, `SELECT COUNT(*) AS total FROM coordination_lead_members m
        JOIN coordination_leads l ON l.id = m.lead_id WHERE l.run_id=?`, COORDINATION_BATCH);
    const scanned = await first(db, 'SELECT COUNT(*) AS leads, COUNT(DISTINCT run_id) AS runs FROM coordination_leads WHERE run_id<>?', COORDINATION_BATCH);
    const statuses = await rows(db, 'SELECT review_status AS status, COUNT(*) AS total FROM coordination_leads GROUP BY review_status');
    const pick = (key: string) => Number(statuses.find(s => s.status === key)?.total ?? 0);
    return {
        leads: Number(summary?.leads ?? 0),
        events: Number(summary?.events ?? 0),
        accounts: Number(accounts?.total ?? 0),
        comments: Number(summary?.comments ?? 0),
        pending: pick('pending'),
        following: pick('following'),
        confirmed: pick('confirmed'),
        dismissed: pick('dismissed'),
        maxAccounts: Number(summary?.maxAccounts ?? 0),
        precomputedLeads: Number(precomputed?.leads ?? 0),
        precomputedEvents: Number(precomputed?.events ?? 0),
        precomputedAccounts: Number(precomputedAccounts?.total ?? 0),
        precomputedComments: Number(precomputed?.comments ?? 0),
        scannedLeads: Number(scanned?.leads ?? 0),
        scannedRuns: Number(scanned?.runs ?? 0),
        runId: COORDINATION_BATCH,
        datasetVersion: COORDINATION_VERSION,
    };
}

export interface LeadQuery {
    page: number;
    pageSize: number;
    q: string;
    namespace: string;
    status: string;
    minAccounts: number;
    eventId: string;
    sort: string;
    runId: string;
}

export function parseLeadQuery(params: URLSearchParams): LeadQuery {
    return {
        page: Math.max(1, Number(params.get('page') || 1) || 1),
        pageSize: Math.min(100, Math.max(5, Number(params.get('pageSize') || 20) || 20)),
        q: (params.get('q') || '').trim().slice(0, 120),
        namespace: (params.get('namespace') || '').trim(),
        status: (params.get('status') || '').trim(),
        minAccounts: Number(params.get('minAccounts') || 0) || 0,
        eventId: (params.get('eventId') || '').trim(),
        sort: params.get('sort') || 'accounts',
        runId: (params.get('runId') || '').trim(),
    };
}

function leadWhere(query: LeadQuery) {
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (query.q) {
        clauses.push('(l.representative_text LIKE ? OR l.id LIKE ? OR e.event_ref LIKE ?)');
        const like = `%${query.q}%`;
        args.push(like, like, like);
    }
    if (query.namespace) {
        clauses.push('l.source_namespace = ?');
        args.push(query.namespace);
    }
    if (query.status) {
        clauses.push('l.review_status = ?');
        args.push(query.status);
    }
    if (query.minAccounts > 0) {
        clauses.push('l.account_count >= ?');
        args.push(query.minAccounts);
    }
    if (query.eventId) {
        clauses.push('l.event_id = ?');
        args.push(query.eventId);
    }
    if (query.runId) {
        if (query.runId === 'scan') {
            clauses.push("l.run_id LIKE 'scan_%'");
        }
        else {
            clauses.push('l.run_id = ?');
            args.push(query.runId);
        }
    }
    return { where: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '', args };
}

const orderOf = (sort: string) => sort === 'recent'
    ? 'l.start_time DESC'
    : sort === 'similarity'
        ? 'l.min_similarity DESC'
        : 'l.account_count DESC, l.comment_count DESC';

export async function listLeads(db: D1Database, query: LeadQuery): Promise<LeadPage> {
    const { where, args } = leadWhere(query);
    const total = await first(db, `SELECT COUNT(*) AS total FROM coordination_leads l JOIN events e ON e.id = l.event_id${where}`, ...args);
    const items = await rows(db, `${leadSelect}${where} ORDER BY ${orderOf(query.sort)} LIMIT ? OFFSET ?`,
        ...args, query.pageSize, (query.page - 1) * query.pageSize);
    return {
        items: items.map(leadRow),
        total: Number(total?.total ?? 0),
        page: query.page,
        pageSize: query.pageSize,
        stats: await getLeadStats(db),
    };
}

export async function getLead(db: D1Database, id: string): Promise<LeadDetail> {
    const row = await first(db, `${leadSelect} WHERE l.id = ?`, id);
    if (!row)
        throw new ApiProblem(404, 'lead_not_found', '线索不存在');
    const base = leadRow(row);
    const members = (await rows(db, 'SELECT * FROM coordination_lead_members WHERE lead_id = ? ORDER BY comment_count DESC, member_key', id))
        .map<LeadMember>(m => ({
            memberKey: String(m.member_key),
            nodeKey: m.node_key ? String(m.node_key) : null,
            commentCount: Number(m.comment_count),
            firstTime: m.first_time === null ? null : Number(m.first_time),
            lastTime: m.last_time === null ? null : Number(m.last_time),
            similarity: m.similarity === null || m.similarity === undefined ? null : Number(m.similarity),
            isRepresentative: !!m.is_representative,
        }));
    return {
        ...base,
        sourceLeadId: Number(row.lead_number),
        eventNodeCount: Number(row.node_count ?? 0),
        eventTimeMin: row.time_min === null || row.time_min === undefined ? null : Number(row.time_min),
        eventTimeMax: row.time_max === null || row.time_max === undefined ? null : Number(row.time_max),
        graphPath: String(row.graph_path ?? ''),
        members,
        comments: JSON.parse(String(row.comments || '[]')),
        similarityEdges: JSON.parse(String(row.similarity_edges || '[]')),
    };
}

export async function reviewLead(db: D1Database, user: User, id: string, status: LeadReviewStatus, note: string) {
    const lead = await first(db, 'SELECT id, representative_text, run_id FROM coordination_leads WHERE id=?', id);
    if (!lead)
        throw new ApiProblem(404, 'lead_not_found', '线索不存在');
    const stamp = now();
    await db.prepare('UPDATE coordination_leads SET review_status=?, review_note=?, reviewer_id=?, reviewer_name=?, reviewed_at=?, reviewed_run_id=? WHERE id=?')
        .bind(status, note, user.id, user.name, stamp, String(lead.run_id), id).run();
    await audit(db, user, '协同线索复核', id, `状态 ${status};结果版本 ${String(lead.run_id)};依据:${note.slice(0, 120)}`);
    return getLead(db, id);
}

export async function listEvents(db: D1Database, query: { page: number; pageSize: number; namespace: string; q: string; batch?: string }) {
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (query.batch) {
        clauses.push('import_batch = ?');
        args.push(query.batch);
    }
    if (query.namespace) {
        clauses.push('source_namespace = ?');
        args.push(query.namespace);
    }
    if (query.q) {
        clauses.push('(event_ref LIKE ? OR id LIKE ?)');
        args.push(`%${query.q}%`, `%${query.q}%`);
    }
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
    const total = await first(db, `SELECT COUNT(*) AS total FROM events${where}`, ...args);
    const items = await rows(db, `SELECT * FROM events${where} ORDER BY node_count DESC, event_line ASC LIMIT ? OFFSET ?`,
        ...args, query.pageSize, (query.page - 1) * query.pageSize);
    return { items: items.map(eventRow), total: Number(total?.total ?? 0), page: query.page, pageSize: query.pageSize };
}

export async function getEvent(db: D1Database, id: string): Promise<EventDetail> {
    const row = await first(db, 'SELECT * FROM events WHERE id=?', id);
    if (!row)
        throw new ApiProblem(404, 'event_not_found', '事件不存在');
    const leads = await rows(db, `${leadSelect} WHERE l.event_id=? ORDER BY l.account_count DESC`, id);
    const edges = await rows(db, 'SELECT source_key,target_key,edge_type,origin,weight,lead_id FROM graph_edges WHERE event_id=? LIMIT 20000', id);
    return {
        event: eventRow(row),
        leads: leads.map(leadRow),
        edges: edges.map<GraphEdgeRecord>(e => ({
            sourceKey: String(e.source_key),
            targetKey: String(e.target_key),
            edgeType: String(e.edge_type) === 'similarity' ? 'similarity' : 'reply',
            origin: String(e.origin) === 'derived' ? 'derived' : 'observed',
            weight: e.weight === null ? null : Number(e.weight),
            leadId: e.lead_id ? String(e.lead_id) : null,
        })),
    };
}

/** 事件图谱:只保留线索相关节点,由需要鉴权的接口返回,不放 public 静态目录。 */
export async function getEventGraph(db: D1Database, id: string) {
    const row = await first(db, 'SELECT id, graph_json FROM events WHERE id=?', id);
    if (!row)
        throw new ApiProblem(404, 'event_not_found', '事件不存在');
    return JSON.parse(String(row.graph_json || '{}'));
}

const STATUS_LABEL: Record<string, string> = { pending: '待复核', following: '保留观察', confirmed: '确认线索', dismissed: '排除线索' };

const beijing = (unix: number | null) => unix === null ? '' : new Date((unix + 8 * 3600) * 1000).toISOString().replace('T', ' ').slice(0, 16);

const csvCell = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
};

/** 可追溯导出:每条线索都带上运行批次、来源定位与复核记录。 */
export async function exportLeads(db: D1Database, user: User, query: LeadQuery) {
    const { where, args } = leadWhere(query);
    const items = await rows(db, `${leadSelect}${where} ORDER BY ${orderOf(query.sort)} LIMIT 5000`, ...args);
    const header = ['线索ID', '分析运行批次', '事件ID', '来源文件', '事件行号', '线索序号', '来源定位', '账号数', '评论数',
        '开始时间(北京时间)', '结束时间(北京时间)', '最小文本相似度', '排序分', '排序分口径', '是否校准概率',
        '复核状态', '复核人', '复核时间', '复核依据', '代表评论', '数据版本', '导出时间'];
    const stamp = now();
    const lines = [header.join(',')];
    for (const row of items) {
        const lead = leadRow(row);
        lines.push([
            lead.id, lead.runId, lead.eventId, String(row.source_file ?? ''), lead.eventRef, lead.leadNumber, lead.eventRef,
            lead.accountCount, lead.commentCount,
            beijing(lead.startTime),
            beijing(lead.endTime),
            lead.minSimilarity ?? '', lead.score ?? '', lead.scoreType, '否(启发式排序分,非校准概率)',
            STATUS_LABEL[lead.reviewStatus] || lead.reviewStatus, lead.reviewerName || '', lead.reviewedAt || '',
            lead.reviewNote, lead.representative, COORDINATION_VERSION, stamp,
        ].map(csvCell).join(','));
    }
    await audit(db, user, '导出协同线索', `${items.length} 条`, `批次 ${COORDINATION_BATCH};版本 ${COORDINATION_VERSION}`);
    return new Response('\uFEFF' + lines.join('\r\n'), {
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="cleartrace-leads-${Date.now()}.csv"`,
            'Cache-Control': 'no-store',
        },
    });
}

/** 账号维度的相关线索:按来源账号键(uid)查询,不做跨来源合并。 */
export async function leadsOfAccount(db: D1Database, accountKey: string, namespace: string) {
    const members = await rows(db, 'SELECT lead_id FROM coordination_lead_members WHERE member_key=? AND account_namespace=? LIMIT 200', accountKey, namespace || 'coordination');
    const ids = members.map(m => String(m.lead_id));
    if (!ids.length)
        return { accountKey, namespace: namespace || 'coordination', leads: [] as CoordinationLead[] };
    const found = await rows(db, `${leadSelect} WHERE l.id IN (${ids.map(() => '?').join(',')}) ORDER BY l.account_count DESC`, ...ids);
    return { accountKey, namespace: namespace || 'coordination', leads: found.map(leadRow) };
}

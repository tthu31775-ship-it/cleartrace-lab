// 协同在线扫描:调用 lib/core/coordination-scan 计算,再把结果按六表落库。
// 结果与"离线 803 条"是两次不同口径的运行:清洗版本不同,不能互相覆盖或声称复现。

import { grams, normalize, runCoordinationScan, similarity, COORDINATION_MODEL_VERSION, PREPROCESSING_VERSION, DEFAULT_SCAN_PARAMETERS, PARAMETER_RANGES } from '../core/coordination-scan';
import type { ScanResult, User } from '../contracts';
import { ApiProblem, audit, first, insertMany, now } from './db';

const COMMENT_LIMIT = 5000;

export function parseScanParameters(raw: unknown) {
    const input = (raw ?? {}) as Record<string, unknown>;
    const result = { ...DEFAULT_SCAN_PARAMETERS };
    for (const key of Object.keys(input)) {
        if (!(key in PARAMETER_RANGES))
            throw new ApiProblem(400, 'invalid_parameters', `不支持的参数 ${key}`);
    }
    for (const [key, [low, high]] of Object.entries(PARAMETER_RANGES) as Array<[keyof typeof PARAMETER_RANGES, [number, number]]>) {
        const value = input[key];
        if (value === undefined)
            continue;
        if (typeof value !== 'number' || !Number.isFinite(value))
            throw new ApiProblem(400, 'invalid_parameters', `parameters.${key} 必须是数值`);
        if (value < low || value > high)
            throw new ApiProblem(400, 'invalid_parameters', `parameters.${key} 必须位于 ${low} 到 ${high}`);
        result[key] = key === 'similarityThreshold' ? value : Math.round(value);
    }
    return result;
}

const stampOf = (date = new Date()) => date.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

function buildGraph(eventRef: string, comments: ReturnType<typeof runCoordinationScan>['comments'], groups: ReturnType<typeof runCoordinationScan>['groups'], leadIds: string[]) {
    const representativeIndexes = new Set<number>();
    for (const group of groups) {
        const hit = group.indices.find(index => comments[index].text === group.representative);
        if (hit !== undefined)
            representativeIndexes.add(hit);
    }
    const nodes = comments.map((comment, index) => ({
        id: `g0n${comment.nodeIndex}`,
        uid: comment.uid,
        text: comment.text,
        time: comment.time,
        likes: comment.likeCount ?? 0,
        replyTo: comment.replyTo,
        leadIds: leadIds
            .map((leadId, leadIndex) => (groups[leadIndex].indices.includes(index) ? leadIndex + 1 : 0))
            .filter(Boolean),
        rep: representativeIndexes.has(index),
    }));
    const idOf = (index: number) => nodes[index].id;
    const groupsPayload = groups.map((group, index) => ({
        leadId: index + 1,
        accountCount: group.accountCount,
        commentCount: group.indices.length,
        start: group.start,
        end: group.end,
        minimumSimilarity: Math.round(group.minSimilarity * 10000) / 10000,
        representative: idOf(group.indices[0]),
        members: group.indices.map(idOf),
        starEdges: group.indices
            .filter(index2 => comments[index2].text !== group.representative)
            .map(index2 => ({
                source: idOf(group.indices[0]),
                target: idOf(index2),
                similarity: Math.round(similarity(normalize(group.representative), comments[index2].normalized, new Map()) * 10000) / 10000,
            })),
    }));
    return {
        eventId: eventRef,
        sourceFile: 'coordination/scan',
        eventLine: 1,
        eventRef,
        timeMin: comments.length ? Math.min(...comments.map(c => c.time)) : null,
        timeMax: comments.length ? Math.max(...comments.map(c => c.time)) : null,
        nodeTotal: nodes.length,
        nodes,
        // 在线输入没有节点级回复关系,不虚构回复边。
        replyEdges: [],
        groups: groupsPayload,
    };
}

/**
 * 执行一次扫描并落库。
 * 每次扫描是一个独立 runId:同一 eventId 重复扫描会新增事件行与线索行,不会覆盖历史结论。
 */
export async function scanCoordinationEvent(db: D1Database, user: User, body: { eventId: string; comments: unknown[]; parameters?: unknown; datasetId?: string | null }): Promise<ScanResult> {
    const eventRef = String(body.eventId || '').trim();
    if (!eventRef || eventRef.length > 200)
        throw new ApiProblem(400, 'invalid_event', 'eventId 必须是 1 到 200 个字符的非空字符串');
    const comments = Array.isArray(body.comments) ? body.comments : [];
    if (!comments.length || comments.length > COMMENT_LIMIT)
        throw new ApiProblem(400, 'invalid_comments', `comments 必须是 1 到 ${COMMENT_LIMIT} 条`);
    const parameters = parseScanParameters(body.parameters);

    const startedAt = Date.now();
    const scan = runCoordinationScan({ comments, parameters });
    const runId = `scan_${stampOf()}_${Math.random().toString(36).slice(2, 6)}`;
    const internalEventId = `event_scan_${runId.slice(5)}`;

    if (!scan.comments.length) {
        return {
            runId, eventId: eventRef, internalEventId, modelVersion: COORDINATION_MODEL_VERSION,
            preprocessingVersion: PREPROCESSING_VERSION, parameters,
            inputCommentCount: comments.length, retainedCommentCount: 0, skipped: scan.skipped,
            leadCount: 0, accounts: 0, leads: [], persisted: false,
            note: '全部评论都被清洗规则排除(空文本/通用短回复/字段缺失),没有可分析的数据,本次不写库。',
        };
    }

    const stamp = now();
    const lineRow = await first(db, "SELECT COALESCE(MAX(event_line),0) AS line FROM events WHERE source_namespace='scan'");
    const eventLine = Number(lineRow?.line ?? 0) + 1;
    const leadIds = scan.groups.map((_, index) => `lead_${runId}_${index + 1}`);
    const graph = buildGraph(eventRef, scan.comments, scan.groups, leadIds);
    const graphJson = JSON.stringify(graph);
    const statements: D1PreparedStatement[] = [];

    statements.push(db.prepare('INSERT INTO events(id,dataset_id,source_namespace,source_file,event_line,event_ref,native_work_id,title,lead_count,node_count,reply_count,max_accounts,lead_node_count,time_min,time_max,time_precision,graph_path,graph_json,import_batch,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(internalEventId, body.datasetId ?? null, 'scan', 'coordination/scan', eventLine, eventRef, null,
            `在线扫描 ${eventRef}`, scan.groups.length, scan.comments.length, 0,
            scan.groups.reduce((max, group) => Math.max(max, group.accountCount), 0),
            scan.comments.length, graph.timeMin, graph.timeMax, 'second',
            `/api/v1/events/${internalEventId}/graph`, graphJson, runId, stamp));

    const leadValues: unknown[][] = [];
    const memberValues: unknown[][] = [];
    const edgeValues: unknown[][] = [];

    scan.groups.forEach((group, index) => {
        const leadId = leadIds[index];
        const members = group.indices.map(i => scan.comments[i]);
        const repComment = members.find(c => c.text === group.representative) ?? members[0];
        const commentsPayload = members
            .slice()
            .sort((a, b) => a.time - b.time)
            .map(comment => ({
                uid: comment.uid,
                text: comment.text,
                time: comment.time,
                likes: comment.likeCount ?? 0,
                node: `g0n${comment.nodeIndex}`,
                rep: comment === repComment,
                replyTo: comment.replyTo,
            }));
        const repNormalized = normalize(group.representative);
        const edgeCache = new Map<string, Set<string>>();
        const similarityEdges: [string, string, number][] = members.map(comment => [
            `g0n${repComment.nodeIndex}`,
            `g0n${comment.nodeIndex}`,
            Math.round(similarity(repNormalized, comment.normalized, edgeCache) * 10000) / 10000,
        ]);
        leadValues.push([
            leadId, runId, internalEventId, 'scan', eventLine, index + 1, group.representative,
            group.accountCount, members.length, group.start, group.end,
            Math.round(group.minSimilarity * 10000) / 10000, group.probability, 'heuristic', 0,
            'pending', '', null, null, null, null,
            JSON.stringify(commentsPayload), JSON.stringify(similarityEdges), stamp,
        ]);
        group.accounts.forEach(account => {
            memberValues.push([
                `${leadId}:${account.accountId}`, leadId, account.accountId, null, 'scan',
                account.commentCount, group.start, group.end, account.meanSimilarity,
                account.accountId === repComment.uid ? 1 : 0, stamp,
            ]);
        });
        similarityEdges.forEach(([source, target, weight]) => {
            edgeValues.push([
                `edge_sim_${leadId}_${source}_${target}`, internalEventId, runId, leadId,
                source, target, 'similarity', 'derived', weight, stamp,
            ]);
        });
    });

    statements.push(...insertMany(db, 'coordination_leads', [
        'id', 'run_id', 'event_id', 'source_namespace', 'event_line', 'lead_number', 'representative_text',
        'account_count', 'comment_count', 'start_time', 'end_time', 'min_similarity', 'score', 'score_type',
        'calibrated', 'review_status', 'review_note', 'reviewer_id', 'reviewer_name', 'reviewed_at',
        'reviewed_run_id', 'comments', 'similarity_edges', 'created_at',
    ], leadValues, true));
    if (memberValues.length) {
        statements.push(...insertMany(db, 'coordination_lead_members', [
            'id', 'lead_id', 'member_key', 'node_key', 'account_namespace', 'comment_count',
            'first_time', 'last_time', 'similarity', 'is_representative', 'created_at',
        ], memberValues, true));
    }
    if (edgeValues.length) {
        statements.push(...insertMany(db, 'graph_edges', [
            'id', 'event_id', 'run_id', 'lead_id', 'source_key', 'target_key', 'edge_type', 'origin', 'weight', 'created_at',
        ], edgeValues, true));
    }
    statements.push(db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
        .bind(`scan_run_${runId}`, JSON.stringify({ eventRef, internalEventId, parameters, preprocessingVersion: PREPROCESSING_VERSION, modelVersion: COORDINATION_MODEL_VERSION, retained: scan.comments.length, groups: scan.groups.length, skipped: scan.skipped, elapsedMs: Date.now() - startedAt }), stamp));

    for (let i = 0; i < statements.length; i += 40)
        await db.batch(statements.slice(i, i + 40));

    await audit(db, user, '事件协同扫描', eventRef, `运行 ${runId};保留 ${scan.comments.length}/${comments.length} 条;线索 ${scan.groups.length} 组;清洗 ${PREPROCESSING_VERSION}`);

    return {
        runId,
        eventId: eventRef,
        internalEventId,
        modelVersion: COORDINATION_MODEL_VERSION,
        preprocessingVersion: PREPROCESSING_VERSION,
        parameters,
        inputCommentCount: comments.length,
        retainedCommentCount: scan.comments.length,
        skipped: scan.skipped,
        leadCount: scan.groups.length,
        accounts: scan.groups.reduce((sum, group) => sum + group.accountCount, 0),
        leads: scan.groups.map((group, index) => ({
            id: leadIds[index],
            leadNumber: index + 1,
            representative: group.representative,
            accountCount: group.accountCount,
            commentCount: group.indices.length,
            startTime: group.start,
            endTime: group.end,
            minSimilarity: Math.round(group.minSimilarity * 10000) / 10000,
            probability: group.probability,
            calibrated: false,
            scoreType: 'heuristic',
            scoreBreakdown: group.scoreBreakdown,
            accounts: group.accounts,
            graphPath: `/api/v1/events/${internalEventId}/graph`,
        })),
        persisted: true,
        note: '排序分是启发式加权分(scoreType=heuristic, calibrated=false),不是身份概率;清洗口径为在线版,与离线 803 条不是同一次运行。',
    };
}

export const scanRunIdOf = (value: string) => `scan_run_${value}`;
void grams;

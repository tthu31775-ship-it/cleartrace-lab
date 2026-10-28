// 评论与文本筛查:抖音小样本导入、评论检索、WB01 单条/批量评分落库、模型状态。
// 所有模型调用都在服务端完成;浏览器只拿业务结果,不接触模型权重或密钥。

import douyinSample from '../data/douyin-sample.json';
import { runCoordinationScan, DEFAULT_SCAN_PARAMETERS } from '../core/coordination-scan';
import { scoreAccount } from '../core/detection';
import { predictComment, WB01_MAX_BATCH, WB01_MAX_LENGTH, WB01_THRESHOLD, WB01_VERSION, wb01ModelInfo } from '../core/wb01';
import type { CommentPrediction, CommentRecord, ModelStatus, ScreeningItem, ScreeningResult, User } from '../contracts';
import { ApiProblem, audit, first, insertMany, now, rows, uuid, type Row } from './db';
import { COORDINATION_BATCH, COORDINATION_VERSION } from './coordination';

const DOUYIN_BATCH = 'douyin-20261022';
const DOUYIN_DATASET_ID = 'dataset-douyin-20261022';
const MANUAL_NAMESPACE = 'manual';

interface SampleComment {
    commentId: string;
    workId: string;
    accountId: string;
    nickname: string;
    content: string;
    publishTime: string;
    likeCount: number;
    ipRegion: string;
    collectedAt: string;
}

const sample = douyinSample as unknown as {
    batch: string;
    platform: string;
    sourceNamespace: string;
    collectedAt: string;
    timePrecision: string;
    timeNote: string;
    ipNote: string;
    likeNote: string;
    works: { workId: string; url: string; declaredCommentCount: number }[];
    accounts: { accountId: string; nickname: string; commentCount: number; workCount: number; firstTime: string; lastTime: string; ipRegion: string }[];
    comments: SampleComment[];
    counts: { works: number; comments: number; accounts: number };
};

export const DOUYIN_COUNTS = sample.counts;

function toIso(value: string) {
    // CSV 里是北京时间且不带时区;显式补 +08:00,避免依赖运行环境时区。
    const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : value + '+08:00';
    const time = Date.parse(normalized);
    return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function commentRow(r: Row): CommentRecord {
    return {
        id: String(r.id),
        datasetId: r.dataset_id ? String(r.dataset_id) : null,
        eventId: r.event_id ? String(r.event_id) : null,
        platform: String(r.platform),
        sourceNamespace: String(r.source_namespace),
        sourceCommentKey: String(r.source_comment_key),
        sourceAccountKey: String(r.source_account_key),
        authorName: String(r.author_name || ''),
        content: String(r.content),
        publishTime: r.publish_time === null || r.publish_time === undefined ? null : Number(r.publish_time),
        publishTimeIso: r.publish_time_iso ? String(r.publish_time_iso) : null,
        timePrecision: String(r.time_precision),
        likeCount: r.like_count === null || r.like_count === undefined ? null : Number(r.like_count),
        likeKnown: !!r.like_known,
        ipRegion: r.ip_region ? String(r.ip_region) : null,
        sourceLocator: String(r.source_locator || ''),
        createdAt: String(r.created_at),
    };
}

/** 导入抖音小样本:5 作品 / 231 评论 / 215 账号,重复导入不翻倍。 */
export async function importDouyinSample(db: D1Database, user: User) {
    const stamp = now();
    const statements: D1PreparedStatement[] = [];
    statements.push(db.prepare("INSERT OR IGNORE INTO datasets(id,name,source,format,version,description,record_count,kind,demo,created_at,created_by) VALUES(?,?,?,?,?,?,?,'douyin',?,?,?)").bind(
        DOUYIN_DATASET_ID, '抖音公开评论区小样本', '抖音网页版公开评论区', 'csv', DOUYIN_BATCH,
        '5 个作品、231 条评论、215 个账号的自采样本。发布时间为相对时间推算的近似值;点赞全为 0,不作为账号画像特征;IP 属地不是网络 IP。',
        sample.counts.comments, 0, stamp, user.id,
    ));

    // 作品在这里作为"事件":native_work_id 保留平台作品 ID,便于回溯原始链接。
    const workIndex = new Map<string, number>();
    sample.works.forEach((work, index) => {
        const eventId = `event_douyin_${work.workId}`;
        workIndex.set(work.workId, index);
        const commentCount = sample.comments.filter(c => c.workId === work.workId).length;
        statements.push(db.prepare('INSERT OR IGNORE INTO events(id,dataset_id,source_namespace,source_file,event_line,event_ref,native_work_id,title,lead_count,node_count,reply_count,max_accounts,lead_node_count,time_min,time_max,time_precision,graph_path,import_batch,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(
            eventId, DOUYIN_DATASET_ID, 'douyin', '抖音评论明细.csv', index + 1,
            `douyin:${work.workId}`, work.workId, `抖音作品 ${work.workId}`,
            0, commentCount, 0, 0, 0,
            null, null, 'approximate', '', DOUYIN_BATCH, stamp,
        ));
    });

    const commentValues: unknown[][] = [];
    for (const comment of sample.comments) {
        const publishIso = toIso(comment.publishTime);
        commentValues.push([
            `comment_douyin_${comment.commentId}`, `event_douyin_${comment.workId}`, DOUYIN_DATASET_ID, 'douyin',
            'douyin', comment.commentId, comment.accountId, 'douyin_sec_uid', comment.nickname, comment.content,
            publishIso ? Math.floor(Date.parse(publishIso) / 1000) : null, publishIso, 'approximate', 'Asia/Shanghai',
            null, comment.likeCount, 0, comment.ipRegion || null,
            `抖音评论明细.csv#${comment.commentId}`, DOUYIN_BATCH, stamp,
        ]);
    }
    statements.push(...insertMany(db, 'comments', [
        'id', 'event_id', 'dataset_id', 'platform', 'source_namespace', 'source_comment_key', 'source_account_key',
        'account_namespace', 'author_name', 'content', 'publish_time', 'publish_time_iso', 'time_precision',
        'timezone', 'reply_to_key', 'like_count', 'like_known', 'ip_region', 'source_locator', 'import_batch', 'created_at',
    ], commentValues, true));

    statements.push(db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind('douyin_import_batch', DOUYIN_BATCH, stamp));
    for (let i = 0; i < statements.length; i += 40)
        await db.batch(statements.slice(i, i + 40));

    const imported = await first(db, 'SELECT COUNT(*) AS total FROM comments WHERE import_batch=?', DOUYIN_BATCH);
    const works = await first(db, 'SELECT COUNT(*) AS total FROM events WHERE import_batch=?', DOUYIN_BATCH);
    const accounts = await first(db, 'SELECT COUNT(DISTINCT source_account_key) AS total FROM comments WHERE import_batch=?', DOUYIN_BATCH);
    await audit(db, user, '导入抖音小样本', DOUYIN_BATCH, `作品 ${Number(works?.total ?? 0)} / 评论 ${Number(imported?.total ?? 0)} / 账号 ${Number(accounts?.total ?? 0)}`);
    return {
        batch: DOUYIN_BATCH,
        works: Number(works?.total ?? 0),
        comments: Number(imported?.total ?? 0),
        accounts: Number(accounts?.total ?? 0),
        expected: sample.counts,
        timePrecision: sample.timePrecision,
        notes: [sample.timeNote, sample.ipNote, sample.likeNote],
    };
}

export async function douyinStatus(db: D1Database) {
    const imported = await first(db, 'SELECT COUNT(*) AS total FROM comments WHERE import_batch=?', DOUYIN_BATCH);
    return {
        batch: DOUYIN_BATCH,
        works: sample.counts.works,
        comments: sample.counts.comments,
        accounts: sample.counts.accounts,
        imported: Number(imported?.total ?? 0) > 0,
        importedComments: Number(imported?.total ?? 0),
        timePrecision: sample.timePrecision,
        note: sample.timeNote,
    };
}

export async function listComments(db: D1Database, params: URLSearchParams) {
    const pageSize = Math.min(200, Math.max(5, Number(params.get('pageSize') || 20) || 20));
    const page = Math.max(1, Number(params.get('page') || 1) || 1);
    const clauses: string[] = [];
    const args: unknown[] = [];
    const namespace = (params.get('namespace') || '').trim();
    if (namespace) {
        clauses.push('source_namespace = ?');
        args.push(namespace);
    }
    const datasetId = (params.get('datasetId') || '').trim();
    if (datasetId) {
        clauses.push('dataset_id = ?');
        args.push(datasetId);
    }
    const q = (params.get('q') || '').trim().slice(0, 100);
    if (q) {
        clauses.push('(content LIKE ? OR author_name LIKE ? OR source_account_key LIKE ?)');
        args.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
    const total = await first(db, `SELECT COUNT(*) AS total FROM comments${where}`, ...args);
    const items = await rows(db, `SELECT * FROM comments${where} ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`,
        ...args, pageSize, (page - 1) * pageSize);
    return { items: items.map(commentRow), total: Number(total?.total ?? 0), page, pageSize };
}

export interface ScreenInput {
    commentId?: string;
    content: string;
    accountId?: string;
    authorName?: string;
    namespace?: string;
    runId?: string;
}

/**
 * 调 WB01 打分并落库。
 * 空文本、超长、模型异常分别记为 error 状态,不转成 0 分;同一 (comment, model, run) 幂等。
 */
export async function screenComments(db: D1Database, user: User, items: ScreenInput[], runIdInput?: string): Promise<ScreeningResult> {
    if (!items.length)
        throw new ApiProblem(400, 'empty_items', '至少提交一条评论');
    if (items.length > WB01_MAX_BATCH)
        throw new ApiProblem(400, 'batch_too_large', `单次最多 ${WB01_MAX_BATCH} 条,请分片提交`);
    const runId = (runIdInput || '').trim() || `run_wb01_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const stamp = now();
    const results: ScreeningItem[] = [];
    let persisted = 0;
    let failed = 0;

    for (const [index, item] of items.entries()) {
        const content = typeof item.content === 'string' ? item.content : '';
        const namespace = (item.namespace || MANUAL_NAMESPACE).trim() || MANUAL_NAMESPACE;
        const sourceKey = (item.commentId || '').trim() || `${runId}_${index}`;
        const commentId = `comment_${namespace}_${sourceKey}`.replace(/[^A-Za-z0-9_:.-]/g, '_');
        if (!content.trim()) {
            failed += 1;
            results.push({ commentId: '', sourceCommentKey: sourceKey, content, status: 'error', error: '评论内容为空' });
            continue;
        }
        if (content.length > WB01_MAX_LENGTH) {
            failed += 1;
            results.push({ commentId: '', sourceCommentKey: sourceKey, content, status: 'error', error: `内容超过 ${WB01_MAX_LENGTH} 字上限(${content.length} 字),请切分后再提交` });
            continue;
        }
        try {
            await db.prepare('INSERT OR IGNORE INTO comments(id,event_id,dataset_id,platform,source_namespace,source_comment_key,source_account_key,account_namespace,author_name,content,publish_time,publish_time_iso,time_precision,timezone,reply_to_key,like_count,like_known,ip_region,source_locator,import_batch,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
                .bind(commentId, null, null, 'manual', namespace, sourceKey, (item.accountId || 'manual-user').slice(0, 200), namespace,
                    (item.authorName || '').slice(0, 120), content, null, stamp, 'unknown', 'unknown', null, null, 0, null,
                    `screening:${runId}#${index}`, runId, stamp).run();
            const stored = await first(db, 'SELECT id FROM comments WHERE source_namespace=? AND source_comment_key=?', namespace, sourceKey);
            const storedId = stored ? String(stored.id) : commentId;
            const prediction = predictComment(content, sourceKey);
            const predictionId = `pred_${storedId}_${WB01_VERSION}_${runId}`;
            await db.prepare('INSERT OR IGNORE INTO comment_predictions(id,comment_id,run_id,capability,model_version,raw_score,threshold,label,risk_level,confidence,evidence,status,error,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
                .bind(predictionId, storedId, runId, 'comment_classification', WB01_VERSION, prediction.probability, prediction.threshold,
                    prediction.label, prediction.risk_level, prediction.confidence, JSON.stringify(prediction.evidence), 'ok', null, stamp, user.name).run();
            persisted += 1;
            results.push({
                commentId: storedId,
                sourceCommentKey: sourceKey,
                content,
                status: 'ok',
                prediction: {
                    id: predictionId,
                    rawScore: prediction.probability,
                    threshold: prediction.threshold,
                    label: prediction.label,
                    riskLevel: prediction.risk_level,
                    confidence: prediction.confidence,
                    evidence: { ...prediction.evidence },
                    modelVersion: prediction.model_version,
                    runId,
                },
            });
        }
        catch (error) {
            failed += 1;
            const message = error instanceof Error ? error.message : '模型调用失败';
            // 失败要留痕:写一条 status=error 的记录,分数留空,不填 0。
            await db.prepare('INSERT OR IGNORE INTO comment_predictions(id,comment_id,run_id,capability,model_version,raw_score,threshold,label,risk_level,confidence,evidence,status,error,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
                .bind(`pred_${commentId}_${WB01_VERSION}_${runId}`, commentId, runId, 'comment_classification', WB01_VERSION, null, WB01_THRESHOLD,
                    'error', 'unknown', 'unknown', '{}', 'error', message.slice(0, 300), stamp, user.name).run().catch(() => undefined);
            results.push({ commentId: '', sourceCommentKey: sourceKey, content, status: 'error', error: message });
        }
    }

    await audit(db, user, '评论文本筛查', `${runId}`, `成功 ${persisted} / 失败 ${failed};模型 ${WB01_VERSION}`);
    return {
        runId,
        modelVersion: WB01_VERSION,
        threshold: WB01_THRESHOLD,
        capability: 'comment_classification',
        persisted,
        failed,
        items: results,
        note: '分数是评论文本筛查分数,不是账号身份概率;confidence 仅由文本长度生成,不是统计置信度。',
    };
}

function predictionRow(r: Row): CommentPrediction {
    return {
        id: String(r.id),
        commentId: String(r.comment_id),
        runId: String(r.run_id),
        modelVersion: String(r.model_version),
        rawScore: r.raw_score === null || r.raw_score === undefined ? null : Number(r.raw_score),
        threshold: Number(r.threshold),
        label: String(r.label),
        riskLevel: String(r.risk_level),
        confidence: String(r.confidence),
        evidence: JSON.parse(String(r.evidence || '{}')),
        status: String(r.status),
        error: r.error ? String(r.error) : null,
        createdAt: String(r.created_at),
        content: r.content ? String(r.content) : undefined,
        sourceNamespace: r.source_namespace ? String(r.source_namespace) : undefined,
        sourceCommentKey: r.source_comment_key ? String(r.source_comment_key) : undefined,
    };
}

export async function listPredictions(db: D1Database, params: URLSearchParams) {
    const limit = Math.min(200, Math.max(5, Number(params.get('limit') || 50) || 50));
    const clauses: string[] = [];
    const args: unknown[] = [];
    const runId = (params.get('runId') || '').trim();
    if (runId) {
        clauses.push('p.run_id = ?');
        args.push(runId);
    }
    const label = (params.get('label') || '').trim();
    if (label) {
        clauses.push('p.label = ?');
        args.push(label);
    }
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
    const items = await rows(db, `SELECT p.*, c.content AS content, c.source_namespace AS source_namespace, c.source_comment_key AS source_comment_key
        FROM comment_predictions p JOIN comments c ON c.id = p.comment_id${where} ORDER BY p.created_at DESC, p.id ASC LIMIT ?`, ...args, limit);
    const stats = await first(db, `SELECT COUNT(*) AS total, SUM(CASE WHEN label='water' THEN 1 ELSE 0 END) AS water,
        SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS failed, COUNT(DISTINCT run_id) AS runs FROM comment_predictions`);
    return {
        items: items.map(predictionRow),
        stats: {
            total: Number(stats?.total ?? 0),
            water: Number(stats?.water ?? 0),
            failed: Number(stats?.failed ?? 0),
            runs: Number(stats?.runs ?? 0),
        },
    };
}

export async function modelStatus(db: D1Database): Promise<ModelStatus> {
    const info = wb01ModelInfo() as ReturnType<typeof wb01ModelInfo> & { train_size?: number };
    const leads = await first(db, 'SELECT COUNT(*) AS total FROM coordination_leads');
    const events = await first(db, "SELECT COUNT(*) AS total FROM events WHERE import_batch=?", COORDINATION_BATCH);
    const douyin = await douyinStatus(db);
    return {
        capabilities: [
            { key: 'comment_classification', name: '评论文本筛查', status: 'ready', version: WB01_VERSION, detail: `字符 1-3gram 哈希 TF-IDF(${info.dimension} 维)+ 线性模型,服务端内置推理,单条/批量 ≤${WB01_MAX_BATCH} 条落库。`, contract: 'POST /api/v1/screening/comments' },
            { key: 'coordination_lookup', name: '协同线索查询', status: 'ready', version: COORDINATION_VERSION, detail: `预计算批次 ${COORDINATION_BATCH}:${Number(leads?.total ?? 0)} 组线索、${Number(events?.total ?? 0)} 个事件,支持列表/详情/复核/导出。`, contract: 'GET /api/v1/leads' },
            { key: 'coordination_scan', name: '新事件在线扫描', status: 'ready', version: 'online-1.0', detail: '在线清洗口径(10 条通用短句)+ 字符 2/3-gram Jaccard + 10 分钟滑窗 + 最少 5 个不同账号;结果按独立 runId 落 events/coordination_leads/成员/相似边/图谱,与离线 803 批分开。输入没有节点级回复关系,图谱不生成回复边。', contract: 'POST /api/v1/coordination/scan' },
            { key: 'account_bert', name: '账号 BERT 模型', status: 'not_ready', version: '—', detail: '算法包只有模板,没有权重与特征契约;正式接口返回 503 MODEL_NOT_READY,mock 分数不入库。', contract: 'POST /api/v1/bert-account/predict(未启用)' },
            { key: 'behavior_baseline', name: '行为规则基线', status: 'ready', version: 'baseline-v1', detail: '工作台原有的账号八项行为特征规则,只作规则参考,与评论模型分数分开显示。', contract: 'POST /api/v1/tasks/:id/run' },
        ],
        wb01: {
            modelVersion: WB01_VERSION,
            threshold: WB01_THRESHOLD,
            dimension: info.dimension,
            features: info.features,
            maxBatch: WB01_MAX_BATCH,
            maxLength: WB01_MAX_LENGTH,
            trainSize: typeof info.train_size === 'number' ? info.train_size : null,
            note: '训练集自评指标偏乐观(acc 0.951 / pos_f1 0.952),5 折文本-only 宏平均 F1 约 0.724,未附独立测试明细;不能对外宣称准确率。',
        },
        coordination: {
            runId: COORDINATION_BATCH,
            leads: Number(leads?.total ?? 0),
            events: Number(events?.total ?? 0),
            version: COORDINATION_VERSION,
            note: '协同线索排序分是启发式加权分(scoreType=heuristic, calibrated=false),不是已校准概率;相似文本不能证明账号身份或组织关系。',
        },
        dataset: {
            batch: douyin.batch,
            works: douyin.works,
            comments: douyin.comments,
            accounts: douyin.accounts,
            imported: douyin.imported,
            timePrecision: douyin.timePrecision,
            note: douyin.note,
        },
        disclaimers: [
            '文本筛查分数与协同线索排序分是两种不同能力的输出,不合并成一个"总水军概率"。',
            '单条评论超过阈值不等于该账号已确认是水军,需人工复核。',
            'BERT 未就绪,Mock 分数不会写入正式结果。',
            'IP 属地是平台公开字段,不是网络 IP,不能作为同设备或协同关系依据。',
        ],
    };
}

export interface CapabilityCheck {
    key: string;
    name: string;
    status: 'pass' | 'fail' | 'not_ready' | 'planned';
    latencyMs: number;
    detail: string;
}

/**
 * 能力自检:真的跑一遍,不是读静态声明。
 * 文本模型跑一条固定探针;线索查询真的查库;在线扫描用 5 条合成评论跑一次内存扫描(不落库);
 * BERT 明确 not_ready;行为基线用一组固定特征跑规则打分。
 */
export async function selfCheck(db: D1Database): Promise<{ checks: CapabilityCheck[]; ranAt: string }> {
    const checks: CapabilityCheck[] = [];

    const probeStarted = performance.now();
    try {
        const probe = predictComment('这事必须严查,转发让更多人看到!');
        checks.push({
            key: 'comment_classification', name: '评论文本筛查', status: 'pass',
            latencyMs: Math.round((performance.now() - probeStarted) * 100) / 100,
            detail: `模型 ${probe.model_version},探针得分 ${probe.probability}(阈值 ${probe.threshold})`,
        });
    }
    catch (error) {
        checks.push({ key: 'comment_classification', name: '评论文本筛查', status: 'fail', latencyMs: 0, detail: error instanceof Error ? error.message : '推理失败' });
    }

    const lookupStarted = performance.now();
    try {
        const leads = await first(db, 'SELECT COUNT(*) AS total FROM coordination_leads');
        const events = await first(db, 'SELECT COUNT(*) AS total FROM events');
        checks.push({
            key: 'coordination_lookup', name: '协同线索查询', status: 'pass',
            latencyMs: Math.round((performance.now() - lookupStarted) * 100) / 100,
            detail: `库内 ${Number(leads?.total ?? 0)} 组线索 / ${Number(events?.total ?? 0)} 个事件`,
        });
    }
    catch (error) {
        checks.push({ key: 'coordination_lookup', name: '协同线索查询', status: 'fail', latencyMs: 0, detail: error instanceof Error ? error.message : '查询失败' });
    }

    const scanStarted = performance.now();
    try {
        const probeComments = Array.from({ length: 5 }, (_, index) => ({
            accountId: `selfcheck_${index}`, text: '自检探针文本同一模板刷屏', publishTime: 1720000000 + index * 30,
        }));
        const scan = runCoordinationScan({ comments: probeComments, parameters: DEFAULT_SCAN_PARAMETERS });
        checks.push({
            key: 'coordination_scan', name: '新事件在线扫描', status: scan.groups.length > 0 ? 'pass' : 'fail',
            latencyMs: Math.round((performance.now() - scanStarted) * 100) / 100,
            detail: `5 条合成评论 → 保留 ${scan.comments.length} 条、命中 ${scan.groups.length} 组(未落库)`,
        });
    }
    catch (error) {
        checks.push({ key: 'coordination_scan', name: '新事件在线扫描', status: 'fail', latencyMs: 0, detail: error instanceof Error ? error.message : '扫描失败' });
    }

    checks.push({
        key: 'account_bert', name: '账号 BERT 模型', status: 'not_ready', latencyMs: 0,
        detail: '未交付权重与特征契约,正式接口返回 503;自检不会用 mock 分数冒充结果',
    });

    const baselineStarted = performance.now();
    try {
        const result = scoreAccount({ postsCount: 2400, followersCount: 20, followingCount: 1200, accountAgeDays: 21, duplicateRatio: 0.8, burstRatio: 0.84, nightRatio: 0.5, avgIntervalSeconds: 9 });
        checks.push({
            key: 'behavior_baseline', name: '行为规则基线', status: 'pass',
            latencyMs: Math.round((performance.now() - baselineStarted) * 100) / 100,
            detail: `样例特征得分 ${result.score}(${result.riskLevel}),模型 ${result.modelVersion}`,
        });
    }
    catch (error) {
        checks.push({ key: 'behavior_baseline', name: '行为规则基线', status: 'fail', latencyMs: 0, detail: error instanceof Error ? error.message : '打分失败' });
    }

    return { checks, ranAt: now() };
}

export const commentIdOf = (namespace: string, key: string) => `comment_${namespace}_${key}`;
export const manualNamespace = MANUAL_NAMESPACE;

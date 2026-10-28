// 数据集详情:按数据集类型给出对应的预览与后续动作。
// 账号型可建摸排任务;评论型看评论;线索型看协同线索。不能把评论数当"账号数"展示。

import type { Account, CommentRecord, CoordinationLead, Dataset, DatasetOverview } from '../contracts';
import { dataset, first, now, rows, type Row } from './db';
import { getAccounts } from './service';

const leadRow = (r: Row): CoordinationLead => ({
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
    reviewStatus: String(r.review_status || 'pending') as CoordinationLead['reviewStatus'],
    reviewNote: String(r.review_note || ''),
    reviewerName: r.reviewer_name ? String(r.reviewer_name) : null,
    reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
    createdAt: String(r.created_at),
});

const commentRow = (r: Row): CommentRecord => ({
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
});

/**
 * 老库里的数据集没有 kind 列值(迁移后默认 accounts),这里一次性按 id 与来源补齐。
 * 只改已知的两类批次,其余保持账号型。
 */
export async function ensureDatasetKinds(db: D1Database) {
    const version = await first(db, "SELECT value FROM settings WHERE key='dataset_kind_version'");
    if (version?.value === '1')
        return;
    await db.batch([
        db.prepare("UPDATE datasets SET kind='douyin' WHERE id=?").bind('dataset-douyin-20261022'),
        db.prepare("UPDATE datasets SET kind='coordination' WHERE id=?").bind('dataset-coordination-20261023'),
        db.prepare("UPDATE datasets SET kind='coordination' WHERE id LIKE 'dataset-scan-%'"),
        db.prepare("INSERT INTO settings(key,value,updated_at) VALUES('dataset_kind_version','1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(now()),
    ]);
}

export interface DatasetDetailPayload {
    dataset: Dataset;
    overview: DatasetOverview;
    accounts: Account[];
    comments: CommentRecord[];
    leads: CoordinationLead[];
}

export async function getDatasetDetail(db: D1Database, id: string): Promise<DatasetDetailPayload | null> {
    const found = await first(db, 'SELECT * FROM datasets WHERE id=?', id);
    if (!found)
        return null;
    const base = dataset(found);

    if (base.kind === 'douyin') {
        const works = await first(db, 'SELECT COUNT(*) AS total FROM events WHERE dataset_id=?', id);
        const reviews = await first(db, 'SELECT COUNT(*) AS total, COUNT(DISTINCT source_account_key) AS accounts FROM comments WHERE dataset_id=?', id);
        const preview = await rows(db, 'SELECT * FROM comments WHERE dataset_id=? ORDER BY publish_time ASC, id LIMIT 8', id);
        const sample = preview[0];
        return {
            dataset: base,
            overview: {
                label: '评论记录',
                unit: '条评论',
                primary: Number(reviews?.total ?? base.recordCount),
                items: [
                    { label: '作品数', value: String(Number(works?.total ?? 0)) },
                    { label: '评论数', value: String(Number(reviews?.total ?? 0)) },
                    { label: '来源账号', value: String(Number(reviews?.accounts ?? 0)) },
                    { label: '时间精度', value: sample && String(sample.time_precision) === 'approximate' ? '近似(相对时间推算)' : '未知' },
                ],
                note: '评论型数据集:可以逐条做文本筛查、查看原文与来源定位,但不产生账号行为画像(不把评论数当账号数)。',
                cta: { label: '去评论检测', page: 'screening' },
            },
            accounts: [],
            comments: preview.map(commentRow),
            leads: [],
        };
    }

    if (base.kind === 'coordination') {
        // 这个数据集代表"预计算批次";在线扫描是另外的运行,单独计数,不混进 803。
        const summary = await first(db, `SELECT COUNT(*) AS leads, COUNT(DISTINCT event_id) AS events,
            COALESCE(SUM(comment_count),0) AS comments, COALESCE(SUM(account_count),0) AS accounts
            FROM coordination_leads WHERE run_id = ?`, base.version);
        const scanned = await first(db, `SELECT COUNT(*) AS leads, COUNT(DISTINCT run_id) AS runs
            FROM coordination_leads WHERE run_id LIKE 'scan_%'`);
        const preview = await rows(db, `SELECT l.*, e.event_ref AS event_ref, e.source_file AS source_file
            FROM coordination_leads l JOIN events e ON e.id = l.event_id
            ORDER BY l.account_count DESC LIMIT 8`);
        return {
            dataset: base,
            overview: {
                label: '线索记录',
                unit: '组线索',
                primary: Number(summary?.leads ?? base.recordCount),
                items: [
                    { label: '涉及事件', value: String(Number(summary?.events ?? 0)) },
                    { label: '线索评论', value: String(Number(summary?.comments ?? 0)) },
                    { label: '账号计数(各组合计)', value: String(Number(summary?.accounts ?? 0)) },
                    { label: '在线扫描', value: `${Number(scanned?.leads ?? 0)} 组 / ${Number(scanned?.runs ?? 0)} 次运行` },
                ],
                note: '线索型数据集:一组线索里的"账号数"是不同来源账号的计数,同一账号可能出现在多组里,不能相加当独立账号总数。',
                cta: { label: '去协同线索', page: 'leads' },
            },
            accounts: [],
            comments: [],
            leads: preview.map(leadRow),
        };
    }

    const accounts = await getAccounts(db, new URLSearchParams({ datasetId: id }));
    const risky = accounts.filter(a => a.riskLevel === 'high').length;
    const reviewed = accounts.filter(a => a.reviewStatus === 'confirmed' || a.reviewStatus === 'dismissed').length;
    return {
        dataset: base,
        overview: {
            label: '账号记录',
            unit: '个账号',
            primary: base.recordCount,
            items: [
                { label: '高风险候选', value: String(risky) },
                { label: '已复核', value: String(reviewed) },
                { label: '待复核', value: String(accounts.filter(a => a.reviewStatus === 'pending').length) },
                { label: '格式', value: base.format.toUpperCase() },
            ],
            note: '账号型数据集:可以基于行为特征创建摸排任务,并逐条人工复核。',
            cta: { label: '基于此数据集新建任务', page: 'accounts' },
        },
        accounts: accounts.slice(0, 8),
        comments: [],
        leads: [],
    };
}

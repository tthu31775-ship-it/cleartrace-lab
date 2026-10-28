// 事件协同扫描:算法包 coordination_scan.py / coordination.py 的等价 TypeScript 实现。
//
// 口径声明:
// - 相似度 = 归一化文本的字符 2/3-gram Jaccard,阈值默认 0.82;
// - 分组 = 同一归一化文本在 10 分钟滑动窗口内至少 5 个不同来源账号;
// - 排序分 = 启发式加权(scoreType=heuristic, calibrated=false),不是身份概率;
// - 清洗口径 = 在线版(10 条通用短句),版本号 preprocessingVersion=online-1.0。
//   离线 803 条用的是 341 项跨事件短句词典,本实现**不声称**复现旧口径。

export const COORDINATION_MODEL_VERSION = 'coordination-char-ngram-1.0.0';
export const PREPROCESSING_VERSION = 'online-1.0';
export const SCAN_MAX_COMMENTS = 5000;
export const SCAN_SHORT_MAX_CHARS = 5;

export interface ScanParameters {
    minAccounts: number;
    windowMinutes: number;
    similarityThreshold: number;
}

export const DEFAULT_SCAN_PARAMETERS: ScanParameters = {
    minAccounts: 5,
    windowMinutes: 10,
    similarityThreshold: 0.82,
};

export const PARAMETER_RANGES: Record<keyof ScanParameters, [number, number]> = {
    minAccounts: [2, 100],
    windowMinutes: [1, 60],
    similarityThreshold: [0.5, 1],
};

/** 在线清洗使用的通用短回复;离线词典 341 项未随包交付,见模块头口径说明。 */
export const COMMON_PHRASES = ['转发微博', '早安', '生日快乐', '关注', '支持', '加油', '愿平安', '注意安全', '哈哈哈', '致敬'];

export interface NormalizedComment {
    uid: string;
    text: string;
    normalized: string;
    time: number;
    nodeIndex: number;
    replyTo: string | null;
    likeCount: number | null;
    metadata: Record<string, unknown>;
}

/** 保守归一化:NFKC + 小写,去掉空白与标点,保留文字、数字与否定词。 */
export function normalize(value: string): string {
    const text = (value || '').normalize('NFKC').toLowerCase();
    let out = '';
    for (const ch of text) {
        if (/\s/u.test(ch) || /\p{P}/u.test(ch))
            continue;
        out += ch;
    }
    return out;
}

export function grams(value: string): Set<string> {
    const set = new Set<string>();
    if (value.length < 2) {
        set.add(value);
        return set;
    }
    for (const n of [2, 3]) {
        for (let i = 0; i + n <= value.length; i += 1)
            set.add(value.slice(i, i + n));
    }
    return set;
}

export function similarity(a: string, b: string, cache: Map<string, Set<string>>): number {
    if (a === b)
        return 1;
    if (!a || !b)
        return 0;
    const longer = Math.max(a.length, b.length);
    const shorter = Math.min(a.length, b.length);
    if (shorter / longer < 0.7)
        return 0;
    const x = cache.get(a) ?? grams(a);
    const y = cache.get(b) ?? grams(b);
    if (!x.size && !y.size)
        return 0;
    let shared = 0;
    for (const gram of x) {
        if (y.has(gram))
            shared += 1;
    }
    const union = x.size + y.size - shared;
    return union === 0 ? 0 : shared / union;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const round4 = (value: number) => Math.round(clamp01(value) * 10000) / 10000;

interface Group {
    indices: number[];
    representative: string;
    minSimilarity: number;
    accountCount: number;
    start: number;
    end: number;
}

/** 候选生成 = 共享字符 gram 反查,再算精确 Jaccard;复杂度低于全量两两比较。 */
function textNeighbors(texts: string[], threshold: number) {
    const cache = new Map<string, Set<string>>();
    const inverted = new Map<string, Set<string>>();
    for (const text of texts) {
        const gramSet = grams(text);
        cache.set(text, gramSet);
        for (const gram of gramSet) {
            const bucket = inverted.get(gram);
            if (bucket)
                bucket.add(text);
            else
                inverted.set(gram, new Set([text]));
        }
    }
    const neighbors = new Map<string, Array<[string, number]>>();
    for (const text of texts) {
        const candidates = new Set<string>();
        for (const gram of cache.get(text) ?? [])
            (inverted.get(gram) ?? new Set<string>()).forEach(t => candidates.add(t));
        const rows: Array<[string, number]> = [];
        for (const other of candidates) {
            const score = similarity(text, other, cache);
            if (score >= threshold)
                rows.push([other, score]);
        }
        neighbors.set(text, rows);
    }
    return neighbors;
}

const lowerBound = (times: number[], value: number) => {
    let low = 0;
    let high = times.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (times[mid] < value)
            low = mid + 1;
        else
            high = mid;
    }
    return low;
};

const upperBound = (times: number[], value: number) => {
    let low = 0;
    let high = times.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (times[mid] <= value)
            low = mid + 1;
        else
            high = mid;
    }
    return low;
};

/**
 * 找候选群组。comments 需先按 (time, nodeIndex) 升序。
 * 与 Python 版一致:锚点遍历、按下标集合去重、按 (账号数, 评论数, 时长, 起点) 排序、
 * 再抑制重叠度 ≥0.8 的滑动窗口(不合并,避免破坏时间窗与代表评论规则)。
 */
export function findGroups(comments: NormalizedComment[], minAccounts: number, windowSeconds: number, threshold: number): Group[] {
    if (new Set(comments.map(c => c.uid)).size < minAccounts)
        return [];

    const byText = new Map<string, number[]>();
    comments.forEach((comment, index) => {
        const bucket = byText.get(comment.normalized);
        if (bucket)
            bucket.push(index);
        else
            byText.set(comment.normalized, [index]);
    });
    const textTimes = new Map<string, number[]>();
    for (const [text, indices] of byText)
        textTimes.set(text, indices.map(index => comments[index].time));

    const neighbors = textNeighbors([...byText.keys()], threshold);
    const seen = new Set<string>();
    const found: Group[] = [];

    for (const anchor of comments) {
        const start = anchor.time;
        const indices: number[] = [];
        const scores: number[] = [];
        for (const [text, score] of neighbors.get(anchor.normalized) ?? []) {
            const times = textTimes.get(text);
            const ids = byText.get(text);
            if (!times || !ids)
                continue;
            const left = lowerBound(times, start);
            const right = upperBound(times, start + windowSeconds);
            for (let i = left; i < right; i += 1)
                indices.push(ids[i]);
            for (let i = left; i < right; i += 1)
                scores.push(score);
        }
        if (new Set(indices.map(index => comments[index].uid)).size < minAccounts)
            continue;
        const sorted = [...new Set(indices)].sort((a, b) => a - b);
        const key = sorted.join(',');
        if (seen.has(key))
            continue;
        seen.add(key);
        found.push({
            indices: sorted,
            representative: anchor.text,
            minSimilarity: scores.length ? Math.min(...scores) : 1,
            accountCount: new Set(sorted.map(index => comments[index].uid)).size,
            start: Math.min(...sorted.map(index => comments[index].time)),
            end: Math.max(...sorted.map(index => comments[index].time)),
        });
    }

    found.sort((a, b) => b.accountCount - a.accountCount
        || b.indices.length - a.indices.length
        || (a.end - a.start) - (b.end - b.start)
        || a.start - b.start);

    const maximal: Group[] = [];
    for (const group of found) {
        const overlaps = maximal.some(larger => {
            const set = new Set(larger.indices);
            let shared = 0;
            for (const index of group.indices) {
                if (set.has(index))
                    shared += 1;
            }
            return shared / Math.min(group.indices.length, larger.indices.length) >= 0.8;
        });
        if (!overlaps)
            maximal.push(group);
    }
    return maximal;
}

export interface PreparedComments {
    comments: NormalizedComment[];
    skipped: Record<string, number>;
}

/** 在线清洗:校验字段、剔除空文本与通用短回复、按 (账号, 原文, 时间) 去重。 */
export function prepareOnlineComments(raw: unknown[]): PreparedComments {
    const common = new Set(COMMON_PHRASES.map(normalize));
    const skipped: Record<string, number> = {};
    const bump = (key: string) => { skipped[key] = (skipped[key] ?? 0) + 1; };
    const seen = new Set<string>();
    const comments: NormalizedComment[] = [];

    raw.forEach((item, index) => {
        const row = (item ?? {}) as Record<string, unknown>;
        const accountId = typeof row.accountId === 'string' ? row.accountId.trim() : '';
        const text = typeof row.text === 'string' ? row.text : '';
        const stamp = row.publishTime;
        if (!accountId || !text.trim() || text.length > 2000 || typeof stamp !== 'number' || !Number.isFinite(stamp)) {
            bump('invalid_field');
            return;
        }
        const normalized = normalize(text);
        if (!normalized) {
            bump('empty_text');
            return;
        }
        if (normalized.length <= SCAN_SHORT_MAX_CHARS && common.has(normalized)) {
            bump('common_short_reply');
            return;
        }
        const key = `${accountId}\u0000${text}\u0000${stamp}`;
        if (seen.has(key)) {
            bump('duplicate_comment_record');
            return;
        }
        seen.add(key);
        comments.push({
            uid: accountId,
            text,
            normalized,
            time: stamp,
            nodeIndex: index,
            replyTo: typeof row.replyTo === 'string' && row.replyTo.trim() ? row.replyTo.trim() : null,
            likeCount: typeof row.likeCount === 'number' ? row.likeCount : null,
            metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {},
        });
    });

    comments.sort((a, b) => a.time - b.time || a.nodeIndex - b.nodeIndex);
    return { comments, skipped };
}

export interface ScoredAccount {
    accountId: string;
    commentCount: number;
    meanSimilarity: number;
    suspectedWaterArmyProbability: number;
    calibrated: false;
    scoreType: 'heuristic';
    scoreBreakdown: {
        textSimilarity: number;
        participation: number;
        timeConcentration: number;
        weights: Record<string, number>;
    };
    evidenceComments: string[];
}

const timeConcentration = (start: number, end: number, windowSeconds: number) =>
    clamp01(1 - Math.max(0, end - start) / Math.max(windowSeconds, 1));

export function scoreAccounts(comments: NormalizedComment[], representative: string, windowSeconds: number): ScoredAccount[] {
    if (!comments.length)
        return [];
    const repNormalized = normalize(representative);
    const cache = new Map<string, Set<string>>();
    for (const text of new Set([repNormalized, ...comments.map(c => c.normalized)]))
        cache.set(text, grams(text));

    const byAccount = new Map<string, Array<{ comment: NormalizedComment; score: number }>>();
    for (const comment of comments) {
        const score = similarity(repNormalized, comment.normalized, cache);
        const bucket = byAccount.get(comment.uid);
        if (bucket)
            bucket.push({ comment, score });
        else
            byAccount.set(comment.uid, [{ comment, score }]);
    }
    const maxParticipation = Math.max(...[...byAccount.values()].map(items => items.length));
    const start = Math.min(...comments.map(c => c.time));
    const end = Math.max(...comments.map(c => c.time));
    const concentration = timeConcentration(start, end, windowSeconds);

    const rows: ScoredAccount[] = [];
    for (const [accountId, items] of byAccount) {
        const meanSimilarity = items.reduce((sum, item) => sum + item.score, 0) / items.length;
        const participation = items.length / maxParticipation;
        const probability = 0.7 * meanSimilarity + 0.2 * participation + 0.1 * concentration;
        rows.push({
            accountId,
            commentCount: items.length,
            meanSimilarity: Math.round(meanSimilarity * 10000) / 10000,
            suspectedWaterArmyProbability: round4(probability),
            calibrated: false,
            scoreType: 'heuristic',
            scoreBreakdown: {
                textSimilarity: Math.round(meanSimilarity * 10000) / 10000,
                participation: Math.round(participation * 10000) / 10000,
                timeConcentration: Math.round(concentration * 10000) / 10000,
                weights: { textSimilarity: 0.7, participation: 0.2, timeConcentration: 0.1 },
            },
            evidenceComments: items.slice(0, 5).map(item => item.comment.text),
        });
    }
    rows.sort((a, b) => b.suspectedWaterArmyProbability - a.suspectedWaterArmyProbability
        || a.accountId.localeCompare(b.accountId));
    return rows;
}

export interface ScoredGroup extends Group {
    accounts: ScoredAccount[];
    probability: number;
    scoreBreakdown: {
        minimumTextSimilarity: number;
        accountScale: number;
        commentScale: number;
        timeConcentration: number;
        weights: Record<string, number>;
    };
}

/** 群组级启发式排序分:0.65 最小相似度 + 0.15 账号规模 + 0.10 评论规模 + 0.10 时间集中度。 */
export function scoreGroup(group: Group, comments: NormalizedComment[], windowSeconds: number): ScoredGroup {
    const members = group.indices.map(index => comments[index]);
    const accountScale = clamp01(group.accountCount / 10);
    const commentScale = clamp01(members.length / 20);
    const concentration = timeConcentration(group.start, group.end, windowSeconds);
    const probability = 0.65 * group.minSimilarity + 0.15 * accountScale + 0.1 * commentScale + 0.1 * concentration;
    return {
        ...group,
        accounts: scoreAccounts(members, group.representative, windowSeconds),
        probability: round4(probability),
        scoreBreakdown: {
            minimumTextSimilarity: Math.round(group.minSimilarity * 10000) / 10000,
            accountScale: Math.round(accountScale * 10000) / 10000,
            commentScale: Math.round(commentScale * 10000) / 10000,
            timeConcentration: Math.round(concentration * 10000) / 10000,
            weights: { minimumTextSimilarity: 0.65, accountScale: 0.15, commentScale: 0.1, timeConcentration: 0.1 },
        },
    };
}

export function runCoordinationScan(input: { comments: unknown[]; parameters: ScanParameters }) {
    const { comments, skipped } = prepareOnlineComments(input.comments);
    const windowSeconds = input.parameters.windowMinutes * 60;
    const groups = findGroups(comments, input.parameters.minAccounts, windowSeconds, input.parameters.similarityThreshold);
    const scored = groups.map(group => scoreGroup(group, comments, windowSeconds));
    scored.sort((a, b) => b.probability - a.probability);
    return { comments, skipped, groups: scored, windowSeconds };
}

import type { Features } from './detection';
export interface InputAccount extends Features {
    accountId: string;
    displayName: string;
    platform: string;
    relatedIds: string[];
    textSamples?: string[];
}
export class ImportError extends Error {
}
export function parseCsv(content: string): Record<string, string>[] {
    const matrix: string[][] = [];
    let row: string[] = [], cell = '', quoted = false;
    const text = content.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            if (quoted && text[i + 1] === '"') {
                cell += '"';
                i++;
            }
            else if (!quoted && cell.length > 0)
                throw new ImportError('CSV 引号必须从字段开头开始');
            else
                quoted = !quoted;
        }
        else if (c === ',' && !quoted) {
            row.push(cell);
            cell = '';
        }
        else if ((c === '\n' || c === '\r') && !quoted) {
            if (c === '\r' && text[i + 1] === '\n')
                i++;
            row.push(cell);
            if (row.some(x => x.trim()))
                matrix.push(row);
            row = [];
            cell = '';
        }
        else
            cell += c;
    }
    if (quoted)
        throw new ImportError('CSV 存在未闭合的双引号');
    row.push(cell);
    if (row.some(x => x.trim()))
        matrix.push(row);
    if (matrix.length < 2)
        throw new ImportError('CSV 需要表头和至少一条数据');
    const headers = matrix.shift()!.map(x => x.trim());
    if (headers.some(x => !x) || new Set(headers).size !== headers.length)
        throw new ImportError('CSV 表头不可为空或重复');
    return matrix.map((r, i) => { if (r.length !== headers.length)
        throw new ImportError(`CSV 第 ${i + 2} 行列数不一致`); return Object.fromEntries(headers.map((h, j) => [h, r[j]])); });
}
const aliases: Record<string, string[]> = { accountId: ['accountId', 'account_id'], displayName: ['displayName', 'display_name'], platform: ['platform'], postsCount: ['postsCount', 'posts_count'], followersCount: ['followersCount', 'followers_count'], followingCount: ['followingCount', 'following_count'], accountAgeDays: ['accountAgeDays', 'account_age_days'], duplicateRatio: ['duplicateRatio', 'duplicate_ratio'], burstRatio: ['burstRatio', 'burst_ratio'], nightRatio: ['nightRatio', 'night_ratio'], avgIntervalSeconds: ['avgIntervalSeconds', 'avg_interval_seconds'], relatedIds: ['relatedIds', 'related_ids'], textSamples: ['textSamples', 'text_samples'] };
export function normalizeRecord(record: unknown): InputAccount {
    if (!record || typeof record !== 'object' || Array.isArray(record))
        throw new ImportError('记录必须是对象');
    const r = record as Record<string, unknown>;
    const get = (key: string) => { for (const alias of aliases[key])
        if (r[alias] !== undefined && r[alias] !== null)
            return r[alias]; return undefined; };
    const string = (key: string, fallback: string, max: number) => { const raw = get(key); const v = raw === undefined ? fallback : String(raw).trim(); if (v.length > max)
        throw new ImportError(`${key} 最长 ${max} 字符`); return v; };
    const accountId = string('accountId', '', 128);
    if (!accountId)
        throw new ImportError('account_id 不能为空');
    const number = (key: string, fallback: number, max: number) => { const raw = get(key); if (raw !== undefined && typeof raw !== 'number' && typeof raw !== 'string')
        throw new ImportError(`${key} 必须是数字`); const v = raw === undefined || raw === '' ? fallback : Number(raw); if (!Number.isFinite(v) || v < 0 || v > max)
        throw new ImportError(`${key} 必须在 0 至 ${max} 之间`); return v; };
    const rawRelated = get('relatedIds');
    const relatedIds = (Array.isArray(rawRelated) ? rawRelated : typeof rawRelated === 'string' ? rawRelated.split(';') : []).map(x => String(x).trim()).filter(Boolean);
    if (relatedIds.length > 100 || relatedIds.some(x => x.length > 128))
        throw new ImportError('related_ids 最多 100 个，每个最长 128 字符');
    const providedText = get('textSamples');
    let textSamples: unknown = providedText === undefined || providedText === '' ? [] : providedText;
    if (typeof textSamples === 'string') {
        try {
            textSamples = JSON.parse(textSamples);
        }
        catch {
            throw new ImportError('text_samples 必须是合法 JSON 字符串数组');
        }
    }
    if (!Array.isArray(textSamples) || textSamples.length > 20 || textSamples.some(x => typeof x !== 'string' || x.length > 1000))
        throw new ImportError('text_samples 最多 20 条文本，每条必须是最多 1000 字符的字符串');
    return { accountId, textSamples: textSamples as string[], displayName: string('displayName', accountId, 100), platform: string('platform', '公开样本', 64), postsCount: number('postsCount', 0, 1e8), followersCount: number('followersCount', 0, 1e9), followingCount: number('followingCount', 0, 1e8), accountAgeDays: number('accountAgeDays', 1, 50000), duplicateRatio: number('duplicateRatio', 0, 1), burstRatio: number('burstRatio', 0, 1), nightRatio: number('nightRatio', 0, 1), avgIntervalSeconds: number('avgIntervalSeconds', 0, 1e9), relatedIds: [...new Set(relatedIds)] };
}
export function validateImport(content: string, format: 'csv' | 'json') {
    let input: unknown;
    if (format === 'csv')
        input = parseCsv(content);
    else {
        try {
            input = JSON.parse(content);
        }
        catch {
            throw new ImportError('JSON 格式无效');
        }
        if (input && typeof input === 'object' && !Array.isArray(input)) {
            const obj = input as Record<string, unknown>;
            input = obj.records ?? obj.accounts;
        }
    }
    if (!Array.isArray(input))
        throw new ImportError('JSON 应为记录数组，或包含 records/accounts 数组的对象');
    if (input.length === 0 || input.length > 1000)
        throw new ImportError('每次导入需要 1 至 1000 条账号记录');
    const seen = new Set<string>();
    const records: InputAccount[] = [];
    let duplicateCount = 0;
    const errors: {
        row: number;
        message: string;
    }[] = [];
    for (let i = 0; i < input.length; i++) {
        try {
            const r = normalizeRecord(input[i]);
            if (seen.has(r.accountId)) {
                duplicateCount++;
                continue;
            }
            seen.add(r.accountId);
            records.push(r);
        }
        catch (e) {
            errors.push({ row: i + (format === 'csv' ? 2 : 1), message: (e as Error).message });
        }
    }
    return { records, rows: input.length, duplicateCount, errors, valid: errors.length === 0 && records.length > 0 };
}

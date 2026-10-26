import { z } from 'zod';
import type { Account } from '../contracts';
import { scoreAccount, classify } from '../core/detection';
import { ApiProblem, runtime } from './db';
export async function infer(accounts: Account[], taskId: string, modelId: string, threshold: number) {
    if (modelId === 'baseline-v1')
        return accounts.map(a => ({ accountId: a.accountId, ...scoreAccount(a, threshold) }));
    const { MODEL_SERVICE_URL: address, MODEL_API_KEY: key } = runtime();
    if (!address)
        throw new ApiProblem(503, 'model_not_configured', '外部算法服务尚未接入，请配置 MODEL_SERVICE_URL 与 MODEL_API_KEY');
    let url: URL;
    try {
        url = new URL(address);
    }
    catch {
        throw new ApiProblem(503, 'model_invalid_url', '算法服务地址配置无效');
    }
    if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|::)/i.test(url.hostname))
        throw new ApiProblem(503, 'model_invalid_url', '算法服务必须使用配置好的公开 HTTPS 地址');
    const payload = { schemaVersion: '1.0', taskId, modelId, accounts: accounts.map(a => ({ accountId: a.accountId, relatedIds: a.relatedIds, textSamples: a.textSamples ?? [], features: { postsCount: a.postsCount, followersCount: a.followersCount, followingCount: a.followingCount, accountAgeDays: a.accountAgeDays, duplicateRatio: a.duplicateRatio, burstRatio: a.burstRatio, nightRatio: a.nightRatio, avgIntervalSeconds: a.avgIntervalSeconds } })) };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        const response = await fetch(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Authorization': `Bearer ${key}` } : {}) }, body: JSON.stringify(payload), signal: controller.signal, redirect: 'error' });
        if (!response.ok)
            throw new ApiProblem(502, 'model_service_error', `算法服务返回 HTTP ${response.status}`);
        const body = await response.text();
        if (body.length > 2000000)
            throw new ApiProblem(502, 'model_response_too_large', '算法返回结果超过限制');
        const schema = z.object({ modelVersion: z.string().min(1).max(100), results: z.array(z.object({ accountId: z.string().min(1), score: z.number().min(0).max(100), reasons: z.array(z.string().max(300)).max(20) })).max(1000) });
        let parsed;
        try {
            parsed = schema.parse(JSON.parse(body));
        }
        catch {
            throw new ApiProblem(502, 'model_schema_error', '算法响应不符合接口协议');
        }
        const expected = new Set(accounts.map(a => a.accountId));
        const seen = new Set<string>();
        for (const result of parsed.results) {
            if (!expected.has(result.accountId) || seen.has(result.accountId))
                throw new ApiProblem(502, 'model_account_mismatch', '算法返回了未知或重复的账号');
            seen.add(result.accountId);
        }
        if (seen.size !== expected.size)
            throw new ApiProblem(502, 'model_result_missing', '算法未返回所有账号的结果');
        return parsed.results.map(r => ({ ...r, riskLevel: classify(r.score, threshold), modelVersion: parsed.modelVersion }));
    }
    catch (e) {
        if (e instanceof ApiProblem)
            throw e;
        if (controller.signal.aborted)
            throw new ApiProblem(504, 'model_timeout', '算法调用超过 20 秒，请重试或分批导入');
        throw new ApiProblem(502, 'model_unreachable', '无法连接外部算法服务');
    }
    finally {
        clearTimeout(timer);
    }
}

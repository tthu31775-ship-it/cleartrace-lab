import type { RiskLevel } from '../contracts';
export interface Features {
    postsCount: number;
    followersCount: number;
    followingCount: number;
    accountAgeDays: number;
    duplicateRatio: number;
    burstRatio: number;
    nightRatio: number;
    avgIntervalSeconds: number;
}
export const BASELINE_VERSION = 'rules-1.0.0';
export function classify(score: number, threshold = 65): RiskLevel { return score >= threshold ? 'high' : score >= Math.max(25, threshold - 25) ? 'medium' : 'low'; }
export function scoreAccount(f: Features, threshold = 65) {
    const frequency = Math.min(1, f.postsCount / Math.max(1, f.accountAgeDays) / 40);
    const fast = f.avgIntervalSeconds > 0 ? Math.max(0, 1 - f.avgIntervalSeconds / 120) : 0;
    const score = Math.max(0, Math.min(100, Math.round(f.duplicateRatio * 35 + f.burstRatio * 30 + frequency * 20 + fast * 10 + f.nightRatio * 5)));
    const reasons: string[] = [];
    if (f.duplicateRatio >= .45)
        reasons.push(`重复内容比例 ${Math.round(f.duplicateRatio * 100)}%`);
    if (f.burstRatio >= .5)
        reasons.push(`集中发布比例 ${Math.round(f.burstRatio * 100)}%`);
    if (frequency >= .5)
        reasons.push(`日均发布 ${(f.postsCount / Math.max(1, f.accountAgeDays)).toFixed(1)} 条`);
    if (fast >= .5)
        reasons.push(`平均发布间隔 ${f.avgIntervalSeconds} 秒`);
    if (!reasons.length)
        reasons.push('当前特征未达到明显异常阈值');
    return { score, riskLevel: classify(score, threshold), reasons, modelVersion: BASELINE_VERSION };
}
export function csvCell(value: unknown): string { let s = String(value ?? ''); if (/^[\s]*[=+@\-\t\r]/.test(s))
    s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }

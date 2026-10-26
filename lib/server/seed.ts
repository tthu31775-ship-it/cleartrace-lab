import { scoreAccount } from '../core/detection';
import type { Features } from '../core/detection';
import { first, insertMany, accountColumns, resultColumns } from './db';
export async function ensureSeed(db: D1Database) {
    if (await first(db, "SELECT value FROM settings WHERE key='seed_version'"))
        return;
    const timestamp = new Date();
    const daysAgo = (n: number) => new Date(timestamp.getTime() - n * 86400000).toISOString();
    const statements: D1PreparedStatement[] = [];
    const names = ['电商评论公开样例', '社区互动研究样例', '转发链路模拟样例'];
    const taskNames = ['电商评论异常行为排查', '社区互动账号初筛', '转发链路协同行为分析', '评论样例二次复核', '社区账号行为对比', '转发样例规则复检'];
    const accountValues: unknown[][] = [];
    const resultValues: unknown[][] = [];
    const reviewValues: unknown[][] = [];
    for (let d = 0; d < 3; d++) {
        const datasetId = `demo-dataset-${d + 1}`;
        statements.push(db.prepare('INSERT OR IGNORE INTO datasets(id,name,source,format,version,description,record_count,demo,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(datasetId, names[d], '系统合成数据', 'json', 'v1.0', '可重复的合成账号与行为特征，用于演示导入、摸排与复核流程；不代表真实账号。', 80, 1, daysAgo(7), 'system'));
        let suspected = 0;
        for (let i = 0; i < 80; i++) {
            const number = d * 80 + i + 1;
            const accid = `DEMO_${String(number).padStart(4, '0')}`;
            const id = `demo-account-${number}`;
            const group = i % 20;
            const high = group < 4;
            const medium = group >= 4 && group < 10;
            const f: Features = { postsCount: high ? 2400 + i * 17 : medium ? 800 + i * 7 : 40 + i * 3, followersCount: high ? 20 + i : medium ? 180 + i * 2 : 700 + i * 23, followingCount: high ? 1200 + i * 8 : medium ? 500 + i * 2 : 180 + i, accountAgeDays: high ? 20 + i % 9 : medium ? 40 + i % 25 : 365 + i * 3, duplicateRatio: high ? .78 + (i % 5) * .04 : medium ? .36 + (i % 5) * .06 : .04 + (i % 7) * .025, burstRatio: high ? .82 + (i % 4) * .04 : medium ? .42 + (i % 4) * .08 : .06 + (i % 5) * .03, nightRatio: high ? .5 + (i % 3) * .1 : medium ? .3 : .1, avgIntervalSeconds: high ? 8 + i % 17 : medium ? 40 + i % 50 : 600 + i * 14 };
            const result = scoreAccount(f);
            if (result.riskLevel !== 'low')
                suspected++;
            const related = group < 10 ? [`DEMO_${String(d * 80 + (Math.floor(i / 10) * 10) + (i + 1) % 10 + 1).padStart(4, '0')}`, `DEMO_${String(d * 80 + (Math.floor(i / 10) * 10) + (i + 3) % 10 + 1).padStart(4, '0')}`] : i % 4 === 0 ? [`DEMO_${String(d * 80 + ((i + 5) % 80) + 1).padStart(4, '0')}`] : [];
            const reviewStatus = result.riskLevel === 'low' ? 'unreviewed' : number % 5 === 0 ? 'dismissed' : number % 7 === 0 ? 'confirmed' : 'pending';
            if (['confirmed', 'dismissed'].includes(reviewStatus))
                reviewValues.push([`demo-review-${number}`, id, reviewStatus, '合成样例预设标签，用于展示人工复核记录。', 'demo-reviewer', '示例复核员', daysAgo(1)]);
            accountValues.push([id, datasetId, accid, `${['评论', '社区', '转发'][d]}样例 ${String(i + 1).padStart(3, '0')}`, ['电商样例', '社区样例', '社交样例'][d], JSON.stringify(f), JSON.stringify(related), result.score, result.riskLevel, reviewStatus, JSON.stringify(result.reasons), result.modelVersion, 1, daysAgo(7)]);
            for (const t of [d, d + 3])
                resultValues.push([`demo-result-${t + 1}-${number}`, `demo-task-${t + 1}`, id, result.score, result.riskLevel, JSON.stringify(result.reasons), result.modelVersion, daysAgo(6 - t)]);
        }
        for (const t of [d, d + 3])
            statements.push(db.prepare('INSERT OR IGNORE INTO tasks(id,name,dataset_id,model_id,threshold,status,total,processed,suspected_count,attempt,error,created_at,started_at,completed_at,created_by,demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(`demo-task-${t + 1}`, taskNames[t], datasetId, 'baseline-v1', 65, 'completed', 80, 80, suspected, 1, null, daysAgo(6 - t), daysAgo(6 - t), daysAgo(6 - t), 'system', 1));
    }
    statements.push(...insertMany(db, 'accounts', accountColumns, accountValues, true));
    statements.push(...insertMany(db, 'results', resultColumns, resultValues, true));
    statements.push(...insertMany(db, 'reviews', ['id', 'account_id', 'status', 'note', 'reviewer_id', 'reviewer_name', 'created_at'], reviewValues, true));
    statements.push(db.prepare('INSERT OR IGNORE INTO audit_logs(id,actor_id,actor,action,target,status,detail,created_at) VALUES(?,?,?,?,?,?,?,?)').bind('demo-log-initialize', 'system', '系统', '示例初始化', '演示工作空间', 'success', '载入 3 个合成数据集、240 个示例账号与 6 个规则基线任务。', timestamp.toISOString()));
    statements.push(db.prepare('INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES(?,?,?)').bind('seed_version', '1.0', timestamp.toISOString()));
    await db.batch(statements);
}

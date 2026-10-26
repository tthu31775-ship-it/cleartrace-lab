import { env } from 'cloudflare:workers';
import type { Account, Dataset, Task, Log, Member, Role } from '../contracts';
import type { Features } from '../core/detection';
export type Row = Record<string, unknown>;
export interface RuntimeEnv {
    DB?: D1Database;
    OWNER_EMAIL?: string;
    INTEGRATION_API_TOKEN?: string;
    MODEL_SERVICE_URL?: string;
    MODEL_API_KEY?: string;
}
export function runtime() { return env as unknown as RuntimeEnv; }
export function database() { const db = runtime().DB; if (!db)
    throw new ApiProblem(503, 'database_unavailable', '数据库尚未配置'); return db; }
export class ApiProblem extends Error {
    constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export const now = () => new Date().toISOString();
export const uuid = (prefix: string) => prefix + '_' + crypto.randomUUID().replaceAll('-', '');
export async function rows(db: D1Database, sql: string, ...args: unknown[]) { return (await db.prepare(sql).bind(...args).all<Row>()).results; }
export async function first(db: D1Database, sql: string, ...args: unknown[]) { return db.prepare(sql).bind(...args).first<Row>(); }
export function account(r: Row): Account { return { id: String(r.id), accountId: String(r.account_id), displayName: String(r.display_name), platform: String(r.platform), datasetId: String(r.dataset_id), ...JSON.parse(String(r.features)) as Features, relatedIds: JSON.parse(String(r.related_ids || '[]')), riskScore: r.risk_score === null ? null : Number(r.risk_score), riskLevel: r.risk_level as Account['riskLevel'], reviewStatus: r.review_status as Account['reviewStatus'], reasons: JSON.parse(String(r.reasons || '[]')), modelVersion: r.model_version ? String(r.model_version) : null, createdAt: String(r.created_at), demo: !!r.demo }; }
export function dataset(r: Row): Dataset { return { id: String(r.id), name: String(r.name), source: String(r.source), format: String(r.format), version: String(r.version), description: String(r.description || ''), recordCount: Number(r.record_count), status: 'ready', demo: !!r.demo, createdAt: String(r.created_at) }; }
export function task(r: Row): Task { return { id: String(r.id), name: String(r.name), datasetId: String(r.dataset_id), datasetName: String(r.dataset_name || ''), modelId: String(r.model_id), modelName: r.model_id === 'baseline-v1' ? '行为规则基线' : '外部算法模型', threshold: Number(r.threshold), status: r.status as Task['status'], total: Number(r.total), processed: Number(r.processed), progress: Number(r.total) ? Math.round(Number(r.processed) / Number(r.total) * 100) : 0, suspectedCount: Number(r.suspected_count), attempt: Number(r.attempt), createdAt: String(r.created_at), startedAt: r.started_at ? String(r.started_at) : null, completedAt: r.completed_at ? String(r.completed_at) : null, error: r.error ? String(r.error) : null, demo: !!r.demo }; }
export function log(r: Row): Log { return { id: String(r.id), actor: String(r.actor), action: String(r.action), target: String(r.target), status: r.status as Log['status'], detail: String(r.detail), createdAt: String(r.created_at) }; }
export function member(r: Row): Member { return { id: String(r.id), email: String(r.email), name: String(r.name), role: r.role as Role, status: r.user_id ? 'active' : 'invited', createdAt: String(r.created_at) }; }
export async function audit(db: D1Database, user: {
    id: string;
    name: string;
}, action: string, target: string, detail = '', status = 'success') { await db.prepare('INSERT INTO audit_logs(id,actor_id,actor,action,target,status,detail,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(uuid('log'), user.id, user.name, action, target, status, detail, now()).run(); }
export function insertMany(db: D1Database, table: string, columns: string[], values: unknown[][], ignore = false) { const size = Math.floor(95 / columns.length); const statements: D1PreparedStatement[] = []; for (let i = 0; i < values.length; i += size) {
    const group = values.slice(i, i + size);
    statements.push(db.prepare(`INSERT ${ignore ? 'OR IGNORE ' : ''}INTO ${table}(${columns.join(',')}) VALUES ${group.map(() => `(${columns.map(() => '?').join(',')})`).join(',')}`).bind(...group.flat()));
} return statements; }
export const accountColumns = ['id', 'dataset_id', 'account_id', 'display_name', 'platform', 'features', 'related_ids', 'risk_score', 'risk_level', 'review_status', 'reasons', 'model_version', 'demo', 'created_at'];
export const resultColumns = ['id', 'task_id', 'account_id', 'score', 'risk_level', 'reasons', 'model_version', 'created_at'];

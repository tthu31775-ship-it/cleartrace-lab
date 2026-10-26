import type { User, Role } from '../contracts';
import { ApiProblem, first, now, runtime, uuid } from './db';
const roles: Role[] = ['admin', 'editor', 'reviewer', 'viewer'];
export async function hashToken(value: string) { const bytes = new TextEncoder().encode(value); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join(''); }
export async function authenticate(request: Request, db: D1Database): Promise<User> {
    if (import.meta.env.DEV)
        return { id: 'local-admin', name: '赵玉骢', email: 'local@cleartrace.test', role: 'admin', local: true };
    const bearer = request.headers.get('authorization');
    if (bearer?.startsWith('Bearer ')) {
        const token = bearer.slice(7);
        if (token.length < 16 || token.length > 512)
            throw new ApiProblem(401, 'invalid_token', '接口令牌无效');
        const hash = await hashToken(token);
        const fixed = runtime().INTEGRATION_API_TOKEN;
        if (fixed && hash === await hashToken(fixed))
            return { id: 'service-integration', name: '数据接入服务', email: '', role: 'editor' };
        const row = await first(db, 'SELECT * FROM api_tokens WHERE token_hash=? AND revoked_at IS NULL', hash);
        if (row && roles.includes(row.role as Role))
            return { id: String(row.id), name: String(row.name), email: '', role: row.role as Role };
        throw new ApiProblem(401, 'invalid_token', '接口令牌无效或已撤销');
    }
    const id = request.headers.get('oai-authenticated-user-id');
    const email = request.headers.get('oai-authenticated-user-email')?.toLowerCase().trim();
    if (!id || !email)
        throw new ApiProblem(401, 'sign_in_required', '请使用 ChatGPT 账号登录工作空间');
    let row = await first(db, 'SELECT * FROM members WHERE user_id=?', id);
    if (!row) {
        row = await first(db, 'SELECT * FROM members WHERE email=?', email);
        if (row) {
            if (row.user_id && row.user_id !== id)
                throw new ApiProblem(403, 'identity_mismatch', '账号身份与成员记录不一致');
            await db.prepare('UPDATE members SET user_id=? WHERE id=? AND user_id IS NULL').bind(id, row.id).run();
        }
        else if (runtime().OWNER_EMAIL?.toLowerCase().trim() === email) {
            await db.prepare('INSERT OR IGNORE INTO members(id,user_id,email,name,role,created_at) VALUES(?,?,?,?,?,?)').bind(uuid('member'), id, email, '赵玉骢', 'admin', now()).run();
            row = await first(db, 'SELECT * FROM members WHERE user_id=?', id);
        }
    }
    if (!row)
        throw new ApiProblem(403, 'membership_required', '你尚未加入此工作空间，请联系管理员添加成员');
    return { id, name: String(row.name), email, role: row.role as Role };
}
export function authorize(user: User, allowed: Role[]) { if (!allowed.includes(user.role))
    throw new ApiProblem(403, 'forbidden', '当前角色无权执行此操作'); }
export function verifyOrigin(request: Request) { const origin = request.headers.get('origin'); if (origin && origin !== new URL(request.url).origin)
    throw new ApiProblem(403, 'origin_rejected', '请求来源不匹配'); }

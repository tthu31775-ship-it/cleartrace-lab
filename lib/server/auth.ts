import type { User, Role } from '../contracts';
import { ApiProblem, first, now, runtime, uuid } from './db';
const roles: Role[] = ['admin', 'editor', 'reviewer', 'viewer'];
export const SESSION_COOKIE = 'ct_session';
const PBKDF2_ITERATIONS = 210_000;
const DEFAULT_TTL_SECONDS = 8 * 3600;
export async function hashToken(value: string) { const bytes = new TextEncoder().encode(value); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join(''); }
const toHex = (bytes: Uint8Array) => [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
function fromHex(value: string) { if (!/^[0-9a-f]*$/.test(value) || value.length % 2)
    throw new ApiProblem(500, 'invalid_hash', '密码散列参数损坏'); const out = new Uint8Array(value.length / 2); for (let i = 0; i < out.length; i++)
    out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16); return out; }
function randomHex(size: number) { return toHex(crypto.getRandomValues(new Uint8Array(size))); }
async function pbkdf2(password: string, saltHex: string, iterations: number) { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']); const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' }, key, 256); return toHex(new Uint8Array(bits)); }
function equalHex(a: string, b: string) { if (a.length !== b.length)
    return false; let diff = 0; for (let i = 0; i < a.length; i++)
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
/** 密码策略:10–200 位,同时包含字母与数字。 */
export function assertPasswordPolicy(password: string) { if (typeof password !== 'string' || password.length < 10 || password.length > 200)
    throw new ApiProblem(400, 'weak_password', '密码长度需为 10–200 位'); if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password))
    throw new ApiProblem(400, 'weak_password', '密码需同时包含字母与数字'); }
export async function setMemberPassword(db: D1Database, memberId: string, password: string) { assertPasswordPolicy(password); const salt = randomHex(16); const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS); await db.prepare('UPDATE members SET password_hash=?,password_salt=?,password_iterations=?,activated_at=? WHERE id=?').bind(hash, salt, PBKDF2_ITERATIONS, now(), memberId).run(); }
async function verifyMemberPassword(db: D1Database, email: string, password: string) { const row = await first(db, 'SELECT * FROM members WHERE email=?', email); if (!row || !row.password_hash || !row.password_salt)
    return null; const iterations = Number(row.password_iterations || PBKDF2_ITERATIONS); const computed = await pbkdf2(password, String(row.password_salt), iterations); return equalHex(computed, String(row.password_hash)) ? row : null; }
export async function verifyOwnPassword(db: D1Database, email: string, password: string) { return !!(await verifyMemberPassword(db, email.toLowerCase().trim(), password)); }
function ttlSeconds() { const raw = Number(runtime().SESSION_TTL_SECONDS || DEFAULT_TTL_SECONDS); return Number.isFinite(raw) && raw >= 300 && raw <= 30 * 86400 ? Math.floor(raw) : DEFAULT_TTL_SECONDS; }
function isHttps(request: Request) { const forwarded = request.headers.get('x-forwarded-proto'); if (forwarded)
    return forwarded.split(',')[0].trim().toLowerCase() === 'https'; try {
    return new URL(request.url).protocol === 'https:';
}
catch {
    return false;
} }
export function sessionCookie(token: string, request: Request, maxAgeSeconds: number) { const secure = isHttps(request) ? '; Secure' : ''; return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`; }
export function clearSessionCookie(request: Request) { const secure = isHttps(request) ? '; Secure' : ''; return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`; }
function cookieToken(request: Request) { const header = request.headers.get('cookie'); if (!header)
    return null; for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0)
        continue;
    if (part.slice(0, index).trim() === SESSION_COOKIE) {
        const value = part.slice(index + 1).trim();
        return /^[0-9a-f]{64}$/.test(value) ? value : null;
    }
} return null; }
export async function createSession(db: D1Database, memberId: string, request: Request) { const token = randomHex(32); const ttl = ttlSeconds(); const expires = new Date(Date.now() + ttl * 1000).toISOString(); await db.prepare('INSERT INTO sessions(id,member_id,token_hash,created_at,expires_at,revoked_at,user_agent) VALUES(?,?,?,?,?,NULL,?)').bind(uuid('session'), memberId, await hashToken(token), now(), expires, (request.headers.get('user-agent') || '').slice(0, 200)).run(); return { token, ttl }; }
export async function revokeSession(db: D1Database, request: Request) { const token = cookieToken(request); if (!token)
    return; await db.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').bind(now(), await hashToken(token)).run(); }
export async function revokeMemberSessions(db: D1Database, memberId: string) { await db.prepare('UPDATE sessions SET revoked_at=? WHERE member_id=? AND revoked_at IS NULL').bind(now(), memberId).run(); }
async function sessionUser(request: Request, db: D1Database): Promise<User | null> { const token = cookieToken(request); if (!token)
    return null; const row = await first(db, 'SELECT s.expires_at AS expires_at, m.id AS member_id, m.email AS email, m.name AS name, m.role AS role FROM sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=? AND s.revoked_at IS NULL', await hashToken(token)); if (!row)
    return null; if (String(row.expires_at) <= now())
    return null; if (!roles.includes(row.role as Role))
    return null; return { id: String(row.member_id), name: String(row.name), email: String(row.email), role: row.role as Role }; }
/** 首个管理员由部署方通过 ADMIN_EMAIL / ADMIN_PASSWORD 初始化,仅在该库还没有已激活管理员时执行一次。 */
export async function ensureAdminAccount(db: D1Database) { const active = await first(db, "SELECT COUNT(*) AS n FROM members WHERE role='admin' AND password_hash IS NOT NULL"); if (Number(active?.n || 0) > 0)
    return false; const email = (runtime().ADMIN_EMAIL || '').toLowerCase().trim(); const password = runtime().ADMIN_PASSWORD || ''; if (!email || !password)
    return false; try {
    assertPasswordPolicy(password);
}
catch {
    console.warn('[cleartrace] ADMIN_PASSWORD 不满足密码策略(≥10 位且含字母与数字),已跳过管理员初始化。');
    return false;
} const existing = await first(db, 'SELECT * FROM members WHERE email=?', email); let memberId: string; if (existing) {
    memberId = String(existing.id);
    await db.prepare("UPDATE members SET role='admin',name=? WHERE id=?").bind(String(existing.name || '管理员'), memberId).run();
}
else {
    memberId = uuid('member');
    await db.prepare('INSERT INTO members(id,user_id,email,name,role,created_at) VALUES(?,NULL,?,?,?,?)').bind(memberId, email, '管理员', 'admin', now()).run();
} await setMemberPassword(db, memberId, password); return true; }
export async function login(db: D1Database, email: string, password: string, request: Request) { const normalized = email.toLowerCase().trim(); const row = await verifyMemberPassword(db, normalized, password); if (!row)
    throw new ApiProblem(401, 'invalid_credentials', '邮箱或密码不正确'); if (!roles.includes(row.role as Role))
    throw new ApiProblem(403, 'forbidden', '该账号角色无效'); const { token, ttl } = await createSession(db, String(row.id), request); return { user: { id: String(row.id), name: String(row.name), email: normalized, role: row.role as Role } as User, cookie: sessionCookie(token, request, ttl) }; }
export async function authenticate(request: Request, db: D1Database): Promise<User> {
    if (import.meta.env.DEV)
        return { id: 'local-admin', name: '赵玉骢', email: 'local@cleartrace.test', role: 'admin', local: true };
    const session = await sessionUser(request, db);
    if (session)
        return session;
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
    // 旧 Sites 身份头只在显式信任上游代理时生效;自建部署默认不信任客户端身份头。
    if ((runtime().TRUST_IDENTITY_HEADERS || '').toLowerCase() === 'true') {
        const id = request.headers.get('oai-authenticated-user-id');
        const email = request.headers.get('oai-authenticated-user-email')?.toLowerCase().trim();
        if (id && email) {
            const row = await first(db, 'SELECT * FROM members WHERE user_id=?', id);
            if (row && roles.includes(row.role as Role))
                return { id, name: String(row.name), email, role: row.role as Role };
        }
    }
    throw new ApiProblem(401, 'sign_in_required', '请使用工作空间账号登录');
}
export function authorize(user: User, allowed: Role[]) { if (!allowed.includes(user.role))
    throw new ApiProblem(403, 'forbidden', '当前角色无权执行此操作'); }
export function verifyOrigin(request: Request) { const origin = request.headers.get('origin'); if (!origin)
    return; const normalized = origin.replace(/\/$/, '').toLowerCase(); const allowed = new Set<string>(); const hosts = new Set<string>(); const addHost = (value: string | null | undefined) => { if (!value)
    return; hosts.add(value.trim().toLowerCase()); }; try {
    const url = new URL(request.url);
    allowed.add(url.origin.toLowerCase());
    addHost(url.host);
}
catch { /* ignore */ } const appOrigin = (runtime().APP_ORIGIN || '').trim().replace(/\/$/, ''); if (appOrigin) {
    allowed.add(appOrigin.toLowerCase());
    try {
        addHost(new URL(appOrigin).host);
    }
    catch { /* ignore */ }
} addHost(request.headers.get('host')); for (const header of ['x-forwarded-host', 'x-original-host', 'x-forwarded-server']) {
    const value = request.headers.get(header);
    if (value)
        addHost(value.split(',')[0]);
} for (const host of hosts) {
    allowed.add('https://' + host);
    allowed.add('http://' + host);
} if (!allowed.has(normalized))
    throw new ApiProblem(403, 'origin_rejected', '请求来源不匹配', { origin: normalized, allowed: [...allowed] }); }

/** 登录失败限速：10 分钟内同一「账号+来源地址」失败 10 次后，后续错误口令返回 429。
 *  注意只在口令错误时计数，正确口令永远放行——否则演示时连续输错会把管理员锁在门外。 */
export const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_SECONDS = 600;

export function clientAddress(request: Request) {
    const headers = request.headers;
    const candidates = [
        headers.get('cf-connecting-ip'),
        headers.get('x-real-ip'),
        (headers.get('x-forwarded-for') || '').split(',')[0].trim(),
    ];
    return candidates.find((value) => value && value.length > 0) || 'local';
}

function loginWindowStart() {
    return new Date(Date.now() - LOGIN_WINDOW_SECONDS * 1000).toISOString();
}

export async function recordLoginFailure(db: D1Database, email: string, address: string) {
    const normalized = email.toLowerCase().trim();
    try {
        await db.prepare('INSERT INTO login_attempts(id,email,ip,ok,created_at) VALUES(?,?,?,?,?)')
            .bind(uuid('attempt'), normalized, address, 0, now()).run();
        // 顺手清理 7 天前的记录，避免这张表无限长
        await db.prepare('DELETE FROM login_attempts WHERE created_at < ?')
            .bind(new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()).run();
        const row = await first(db, 'SELECT COUNT(*) AS n FROM login_attempts WHERE email=? AND ip=? AND ok=0 AND created_at > ?', normalized, address, loginWindowStart());
        return Number(row?.n ?? 0);
    }
    catch {
        // 迁移 0005 还没应用时不要因为限速表缺失把登录打成 500：限速是尽力而为的保护
        return 0;
    }
}

export async function clearLoginFailures(db: D1Database, email: string, address: string) {
    try {
        await db.prepare('DELETE FROM login_attempts WHERE email=? AND ip=? AND ok=0')
            .bind(email.toLowerCase().trim(), address).run();
    }
    catch {
        // 同上：表不存在就跳过
    }
}

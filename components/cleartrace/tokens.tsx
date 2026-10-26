'use client';
import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { Role } from '@/lib/contracts';
import { api, Badge, date, roleNames, Spinner } from './common';
interface Token {
    id: string;
    name: string;
    role: Role;
    createdAt: string;
    revokedAt: string | null;
}
export function Tokens({ notify, onChange }: {
    notify: (message: string, type?: 'success' | 'error') => void;
    onChange: () => void;
}) {
    const [tokens, setTokens] = useState<Token[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [name, setName] = useState('');
    const [role, setRole] = useState<Role>('editor');
    const [busy, setBusy] = useState(false);
    const [secret, setSecret] = useState('');
    const [copied, setCopied] = useState(false);
    const [confirm, setConfirm] = useState<string | null>(null);
    async function load() { try {
        setTokens(await api<Token[]>('/tokens'));
        setError('');
    }
    catch (e) {
        setError(e instanceof Error ? e.message : '令牌列表加载失败');
    }
    finally {
        setLoading(false);
    } }
    useEffect(() => { load(); }, []);
    async function create(e: React.FormEvent) { e.preventDefault(); setBusy(true); try {
        const token = await api<Token & {
            token: string;
        }>('/tokens', { name: name.trim(), role });
        setSecret(token.token);
        setCopied(false);
        setName('');
        await load();
        onChange();
        notify('接口令牌已创建。完整值仅在此显示一次。');
    }
    catch (e) {
        notify(e instanceof Error ? e.message : '创建失败', 'error');
    }
    finally {
        setBusy(false);
    } }
    async function revoke(id: string) { setBusy(true); try {
        await api('/tokens/' + id, undefined, 'DELETE');
        setConfirm(null);
        await load();
        onChange();
        notify('接口令牌已撤销。');
    }
    catch (e) {
        notify(e instanceof Error ? e.message : '撤销失败', 'error');
    }
    finally {
        setBusy(false);
    } }
    async function copy() { try {
        await navigator.clipboard.writeText(secret);
        setCopied(true);
    }
    catch {
        notify('复制失败，请手动选择令牌。', 'error');
    } }
    return <section className="token-manager"><div className="token-heading"><KeyRound size={19}/><div><h3>接口访问令牌</h3><p>为数据脚本或算法服务分别创建令牌，按职责分配权限。</p></div></div>{secret && <div className="token-secret"><div><strong>请保存新令牌，关闭后无法再次查看完整值。</strong><button className="text-link" onClick={() => setSecret('')}>已妥善保存</button></div><div><code>{secret}</code><button className="button" onClick={copy}>{copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? '已复制' : '复制令牌'}</button></div></div>}<form className="token-form" onSubmit={create}><label className="field"><span>令牌用途</span><input required value={name} onChange={e => setName(e.target.value)} maxLength={100} placeholder="例如：数据组导入脚本"/></label><label className="field"><span>操作权限</span><select value={role} onChange={e => setRole(e.target.value as Role)}><option value="editor">开发成员</option><option value="reviewer">复核成员</option><option value="viewer">只读成员</option></select></label><button className="button button-primary" disabled={busy || !name.trim()}>{busy ? <Spinner text="处理中"/> : <><Plus size={16}/>创建令牌</>}</button></form>{error && <div className="inline-error">{error}</div>}{loading ? <Spinner /> : <div className="token-list">{tokens.length ? tokens.map(token => <div className="token-row" key={token.id}><KeyRound size={16}/><div><strong>{token.name}</strong><small>{roleNames[token.role]} · {date(token.createdAt, true)}</small></div><Badge kind={token.revokedAt ? 'neutral' : 'teal'}>{token.revokedAt ? '已撤销' : '有效'}</Badge>{!token.revokedAt && (confirm === token.id ? <span className="token-confirm"><span>立即撤销？</span><button disabled={busy} onClick={() => revoke(token.id)}>确认</button><button onClick={() => setConfirm(null)}>返回</button></span> : <button className="icon-button" title="撤销令牌" aria-label={'撤销令牌 ' + token.name} onClick={() => setConfirm(token.id)}><Trash2 size={16}/></button>)}</div>) : <p className="muted small-text">尚未创建接口令牌。</p>}</div>}<p className="token-footnote"><ShieldCheck size={14}/>后端只存储令牌摘要。撤销后，使用该令牌的请求会被拒绝。</p></section>;
}

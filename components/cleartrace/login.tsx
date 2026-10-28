'use client';
import { useState } from 'react';
import { AlertCircle, ArrowRight, LoaderCircle, ShieldCheck, Waves } from 'lucide-react';
import { api } from './common';
import type { User } from '@/lib/contracts';

const shell: React.CSSProperties = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 20px', background: 'radial-gradient(1200px 600px at 15% 0%, #eef7f3 0%, #f7fafb 45%, #f1f6f7 100%)' };
const card: React.CSSProperties = { width: '100%', maxWidth: '392px', background: '#fff', border: '1px solid #e3edef', borderRadius: '14px', boxShadow: '0 18px 48px rgba(23,73,61,.08)', padding: '34px 32px 28px' };
const label: React.CSSProperties = { display: 'block', fontSize: '13px', color: '#5b7480', marginBottom: '7px' };
const input: React.CSSProperties = { width: '100%', height: '42px', border: '1px solid #dde8ea', borderRadius: '8px', padding: '0 12px', fontSize: '13px', color: '#2f4650', background: '#fbfdfd', outline: 'none', boxSizing: 'border-box' };
const submit: React.CSSProperties = { width: '100%', height: '44px', marginTop: '22px', border: '0', borderRadius: '8px', background: '#3f9c81', color: '#fff', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' };

export function LoginScreen({ onSignedIn }: { onSignedIn: (user: User) => void }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            const user = await api<User>('/auth/login', { email: email.trim(), password });
            onSignedIn(user);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : '登录失败');
        }
        finally {
            setBusy(false);
        }
    }
    return <div style={shell}><div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '26px' }}>
            <span style={{ width: '42px', height: '42px', borderRadius: '11px', background: '#eaf6f1', color: '#3f9c81', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Waves size={24}/></span>
            <div><strong style={{ display: 'block', fontSize: '17px', letterSpacing: '.06em', color: '#26424c' }}>清源</strong><small style={{ fontSize: '10px', letterSpacing: '.16em', color: '#8aa0a8' }}>CLEARTRACE</small></div>
        </div>
        <h1 style={{ margin: '0 0 6px', fontSize: '19px', color: '#223c45', fontWeight: 600 }}>登录研究工作空间</h1>
        <p style={{ margin: '0 0 24px', fontSize: '12px', color: '#7d949e', lineHeight: 1.7 }}>网络水军候选行为研判工作台。请使用管理员分配的工作空间账号登录。</p>
        <form onSubmit={submit}>
            <label style={label} htmlFor="ct-email">登录邮箱</label>
            <input id="ct-email" type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" style={input}/>
            <label style={{ ...label, marginTop: '16px' }} htmlFor="ct-password">登录密码</label>
            <input id="ct-password" type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 10 位，含字母与数字" style={input}/>
            {error && <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '14px', fontSize: '12px', color: '#b3583f', background: '#fdf4f1', border: '1px solid #f2ddd6', borderRadius: '7px', padding: '9px 11px' }}><AlertCircle size={15}/><span>{error}</span></div>}
            <button type="submit" disabled={busy} style={{ ...submit, opacity: busy ? .72 : 1 }}>{busy ? <><LoaderCircle size={16} className="spin"/>正在验证</> : <>登录工作空间<ArrowRight size={16}/></>}</button>
        </form>
        <div style={{ marginTop: '22px', paddingTop: '16px', borderTop: '1px solid #eef4f5', display: 'flex', gap: '7px', fontSize: '11px', color: '#93a8b0', lineHeight: 1.7 }}><ShieldCheck size={14} style={{ flexShrink: 0, marginTop: '2px' }}/><span>会话保存在服务端，登录以 HttpOnly Cookie 传递。账号与密码由项目管理员在「项目协作」中分配与重置。</span></div>
    </div></div>;
}

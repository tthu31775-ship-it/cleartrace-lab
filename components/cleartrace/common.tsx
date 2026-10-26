'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { X, LoaderCircle, CheckCircle2, AlertCircle, Inbox, ArrowRight } from 'lucide-react';
import type { RiskLevel, ReviewStatus, TaskStatus, Role } from '@/lib/contracts';
export const roleNames: Record<Role, string> = { admin: '管理员', editor: '开发成员', reviewer: '复核成员', viewer: '只读成员' };
export const riskNames: Record<RiskLevel, string> = { high: '高风险候选', medium: '需关注', low: '低风险', unscored: '未识别' };
export const reviewNames: Record<ReviewStatus, string> = { pending: '待人工复核', confirmed: '已确认异常', dismissed: '已排除异常', unreviewed: '未复核' };
export const taskNames: Record<TaskStatus, string> = { queued: '待执行', running: '运行中', completed: '已完成', failed: '执行失败', cancelled: '已取消' };
export const fmt = (n: number) => n.toLocaleString('zh-CN');
export const date = (s: string, short = false) => { if (!s)
    return '—'; const d = new Date(s); return Number.isNaN(d.valueOf()) ? s : d.toLocaleString('zh-CN', short ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' } : { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); };
export const datasetColor = (n: number) => ['teal', 'blue', 'purple', 'amber'][n % 4];
export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
        const res = await fetch('/api/v1' + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
        const json = await res.json() as {
            data: T;
            error?: {
                message?: string;
            };
        };
        if (!res.ok)
            throw new Error(json.error?.message || `请求失败 (${res.status})`);
        return json.data as T;
    }
    catch (error) {
        if (error instanceof Error && error.name === 'AbortError')
            throw new Error('请求超时，请检查任务状态后重试。');
        throw error;
    }
    finally {
        clearTimeout(timer);
    }
}
export function downloadText(name: string, content: string, type = 'text/plain;charset=utf-8') { const a = document.createElement('a'); const url = URL.createObjectURL(new Blob(['\uFEFF' + content], { type })); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export async function downloadCsv(path: string, name: string) { const res = await fetch('/api/v1' + path); if (!res.ok) {
    const data = await res.json() as {
        error?: {
            message?: string;
        };
    };
    throw new Error(data.error?.message || '导出失败');
} const blob = await res.blob(); const a = document.createElement('a'); const url = URL.createObjectURL(blob); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function Badge({ kind = 'neutral', children, dot = false }: {
    kind?: string;
    children: ReactNode;
    dot?: boolean;
}) { return <span className={'badge badge-' + kind}>{dot && <i />}{children}</span>; }
export function RiskBadge({ risk }: {
    risk: RiskLevel;
}) { return <Badge kind={risk === 'high' ? 'amber' : risk === 'medium' ? 'blue' : risk === 'low' ? 'teal' : 'neutral'} dot>{riskNames[risk]}</Badge>; }
export function TaskBadge({ status }: {
    status: TaskStatus;
}) { return <Badge kind={status === 'completed' ? 'teal' : status === 'failed' ? 'red' : status === 'running' ? 'blue' : 'neutral'} dot>{taskNames[status]}</Badge>; }
export function Empty({ title = '暂无数据', text = '调整筛选条件，或添加一条新记录。', action }: {
    title?: string;
    text?: string;
    action?: ReactNode;
}) { return <div className="empty-state"><div className="empty-icon"><Inbox size={26}/></div><h3>{title}</h3><p>{text}</p>{action}</div>; }
export function SectionTitle({ title, subtitle, action }: {
    title: string;
    subtitle?: string;
    action?: ReactNode;
}) { return <div className="section-title"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>; }
export function ArrowLink({ children, onClick }: {
    children: ReactNode;
    onClick: () => void;
}) { return <button className="text-link" onClick={onClick}>{children}<ArrowRight size={14}/></button>; }
export function Spinner({ text = '正在加载' }: {
    text?: string;
}) { return <span className="spinner-inline"><LoaderCircle size={17} className="spin"/>{text}</span>; }
export function Modal({ title, subtitle, children, onClose, wide = false, drawer = false }: {
    title: string;
    subtitle?: string;
    children: ReactNode;
    onClose: () => void;
    wide?: boolean;
    drawer?: boolean;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    useEffect(() => { const before = document.activeElement as HTMLElement; const old = document.body.style.overflow; document.body.style.overflow = 'hidden'; ref.current?.focus(); const handle = (e: KeyboardEvent) => { if (e.key === 'Escape')
        closeRef.current(); if (e.key === 'Tab') {
        const list = ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]');
        if (!list?.length)
            return;
        const first = list[0], last = list[list.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
            e.preventDefault();
            last.focus();
        }
        else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    } }; document.addEventListener('keydown', handle); return () => { document.body.style.overflow = old; document.removeEventListener('keydown', handle); before?.focus(); }; }, []);
    return <div className={'modal-backdrop' + (drawer ? ' drawer-backdrop' : '')} onMouseDown={e => { if (e.target === e.currentTarget)
        onClose(); }}><div className={'modal' + (wide ? ' modal-wide' : '') + (drawer ? ' drawer' : '')} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}><div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button aria-label="关闭窗口" className="icon-button" onClick={onClose}><X size={20}/></button></div><div className="modal-body">{children}</div></div></div>;
}
export function Toast({ text, type, onClose }: {
    text: string;
    type: 'success' | 'error';
    onClose: () => void;
}) { useEffect(() => { const timer = setTimeout(onClose, 6000); return () => clearTimeout(timer); }, [text, onClose]); return <div className={'toast toast-' + type} role={type === 'error' ? 'alert' : 'status'}>{type === 'success' ? <CheckCircle2 size={19}/> : <AlertCircle size={19}/>}<span>{text}</span><button aria-label="关闭提示" onClick={onClose}><X size={16}/></button></div>; }

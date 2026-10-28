'use client';
// 协同线索 / 评论检测 / 模型接入 三个新页面。
// 所有数据来自业务后端;模型分数、排序分、复核结论分别展示,不合并成一个概率。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Download, Filter, GitBranch, Layers, Network, Play, RefreshCw, Search, ShieldAlert, Upload } from 'lucide-react';
import type { CommentRecord, CoordinationLead, EventDetail, LeadDetail, LeadPage, LeadReviewStatus, ModelStatus, ScreeningResult, SelfCheckResult } from '@/lib/contracts';
import { api, Badge, downloadCsv, downloadText, Empty, SectionTitle, Spinner } from './common';
import type { PanelProps } from './panels';

const bjTime = (t: number | null | undefined, withDate = true) => {
    if (t === null || t === undefined)
        return '—';
    const d = new Date(t * 1000);
    return d.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        ...(withDate ? { month: '2-digit', day: '2-digit' } : {}),
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
};

const prettyDate = (iso: string | null) => {
    if (!iso)
        return '—';
    const d = new Date(iso);
    return Number.isNaN(d.valueOf()) ? iso : d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
};

const leadStatusNames: Record<LeadReviewStatus, string> = { pending: '待复核', following: '保留观察', confirmed: '确认线索', dismissed: '排除线索' };
const leadStatusKind = (status: string) => status === 'confirmed' ? 'red' : status === 'dismissed' ? 'teal' : status === 'following' ? 'blue' : 'amber';
const riskKind = (risk: string) => risk === 'high' ? 'red' : risk === 'medium' ? 'amber' : risk === 'low' ? 'teal' : 'neutral';
const riskNames: Record<string, string> = { high: '高分候选', medium: '需关注', low: '低分', unknown: '无法判定' };

// ---------- 协同线索 ----------

export function Leads(p: PanelProps) {
    const [page, setPage] = useState(1);
    const [q, setQ] = useState('');
    const [namespace, setNamespace] = useState('');
    const [status, setStatus] = useState('');
    const [minAccounts, setMinAccounts] = useState(0);
    const [sort, setSort] = useState('accounts');
    const [runFilter, setRunFilter] = useState('');
    const [data, setData] = useState<LeadPage | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [openId, setOpenId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), pageSize: '20', sort });
            if (q.trim())
                params.set('q', q.trim());
            if (namespace)
                params.set('namespace', namespace);
            if (status)
                params.set('status', status);
            if (minAccounts)
                params.set('minAccounts', String(minAccounts));
            if (runFilter)
                params.set('runId', runFilter);
            setData(await api<LeadPage>('/leads?' + params.toString()));
            setError('');
        }
        catch (e) {
            setError(e instanceof Error ? e.message : '线索加载失败');
        }
        finally {
            setLoading(false);
        }
    }, [page, q, namespace, status, minAccounts, sort, runFilter]);

    useEffect(() => { load(); }, [load]);

    const stats = data?.stats;
    const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 20)));
    const reset = <T,>(setter: (v: T) => void) => (value: T) => { setter(value); setPage(1); };

    return <>
        <div className="notice-mark"><Layers size={17}/><span>本页是算法包交付的<strong>预计算批次</strong>(离线扫描结果),不是本站新扫描的实时数据。相似文本只表示表达接近,不能证明账号身份或组织关系。</span></div>
        {stats && <div className="metric-grid">
            <div className="metric-card"><div className="metric-top"><span className="metric-icon metric-icon-1"><Network size={17}/></span><span className="tiny-label">协同候选线索</span></div><strong>{stats.leads}</strong><span className="metric-caption">预计算 {stats.precomputedLeads} · 在线扫描 {stats.scannedLeads}({stats.scannedRuns} 次运行)</span></div>
            <div className="metric-card"><div className="metric-top"><span className="metric-icon metric-icon-2"><ShieldAlert size={17}/></span><span className="tiny-label">待人工复核</span></div><strong>{stats.pending}</strong><span className="metric-caption">已确认 {stats.confirmed} · 保留 {stats.following} · 排除 {stats.dismissed}</span></div>
            <div className="metric-card"><div className="metric-top"><span className="metric-icon metric-icon-3"><GitBranch size={17}/></span><span className="tiny-label">来源事件与账号</span></div><strong>{stats.precomputedEvents}</strong><span className="metric-caption">{stats.precomputedAccounts} 条账号记录 · 单组最多 {stats.maxAccounts} 个账号</span></div>
            <div className="metric-card"><div className="metric-top"><span className="metric-icon metric-icon-1"><CheckCircle2 size={17}/></span><span className="tiny-label">批次与版本</span></div><strong style={{ fontSize: '15px', letterSpacing: '-.01em' }}>{stats.datasetVersion}</strong><span className="metric-caption mono">{stats.runId}</span></div>
        </div>}
        <section className="card">
            <SectionTitle title="协同线索库" subtitle="按事件、来源、账号数、复核状态筛选;每条线索都保留来源文件与行号。" action={<button className="button button-soft" onClick={async () => {
                try {
                    const params = new URLSearchParams({ sort });
                    if (q.trim())
                        params.set('q', q.trim());
                    if (namespace)
                        params.set('namespace', namespace);
                    if (status)
                        params.set('status', status);
                    if (minAccounts)
                        params.set('minAccounts', String(minAccounts));
                    if (runFilter)
                        params.set('runId', runFilter);
                    await downloadCsv('/leads/export?' + params.toString(), '清源-协同线索明细.csv');
                    p.notify('线索明细已导出,包含运行批次、来源定位与复核记录。');
                }
                catch (e) {
                    p.notify(e instanceof Error ? e.message : '导出失败', 'error');
                }
            }}><Download size={15}/>导出明细</button>}/>
            <div className="table-toolbar filter-toolbar">
                <label className="search-input"><Search size={16}/><input value={q} onChange={e => reset(setQ)(e.target.value)} placeholder="搜索代表评论、线索 ID 或事件" aria-label="搜索线索"/></label>
                <div className="filter-group"><Filter size={15}/>
                    <select value={namespace} onChange={e => reset(setNamespace)(e.target.value)} aria-label="来源文件">
                        <option value="">全部来源</option>
                        <option value="trend">trend_information.jsonl</option>
                        <option value="verified">verified_information.jsonl</option>
                    </select>
                    <select value={status} onChange={e => reset(setStatus)(e.target.value)} aria-label="复核状态">
                        <option value="">全部复核状态</option>
                        {Object.entries(leadStatusNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                    <select value={String(minAccounts)} onChange={e => reset(setMinAccounts)(Number(e.target.value))} aria-label="最少账号数">
                        <option value="0">不限账号数</option>
                        <option value="5">≥ 5 账号</option>
                        <option value="10">≥ 10 账号</option>
                        <option value="20">≥ 20 账号</option>
                        <option value="50">≥ 50 账号</option>
                    </select>
                    <select value={runFilter} onChange={e => reset(setRunFilter)(e.target.value)} aria-label="批次">
                        <option value="">全部批次</option>
                        <option value="coordination-20261023">预计算批次(803)</option>
                        <option value="scan">在线扫描结果</option>
                    </select>
                    <select value={sort} onChange={e => reset(setSort)(e.target.value)} aria-label="排序">
                        <option value="accounts">按账号数</option>
                        <option value="similarity">按最小相似度</option>
                        <option value="recent">按时间</option>
                    </select>
                </div>
                <button className="icon-button" title="刷新" aria-label="刷新线索" onClick={load}><RefreshCw size={16} className={loading ? 'spin' : ''}/></button>
            </div>
            {error && <div className="inline-error"><AlertCircle size={16}/>{error}</div>}
            <div className="table-scroll">
                <table className="data-table">
                    <thead><tr><th>线索 / 代表评论</th><th>来源事件</th><th>账号数</th><th>评论数</th><th>时间窗(北京时间)</th><th>最小相似度</th><th>复核状态</th><th className="align-right">操作</th></tr></thead>
                    <tbody>{(data?.items ?? []).map(lead => <tr key={lead.id}>
                        <td><button className="table-main" onClick={() => setOpenId(lead.id)}><span className="account-avatar avatar-medium">{String(lead.leadNumber).slice(-2)}</span><span><strong>{lead.representative.slice(0, 26) || lead.id}</strong><small className="mono">{lead.id} · 序号 {lead.leadNumber}</small></span></button></td>
                        <td><span className="mono">{lead.eventRef}</span><small className="cell-secondary">{lead.sourceNamespace}_information.jsonl</small></td>
                        <td><strong>{lead.accountCount}</strong></td>
                        <td>{lead.commentCount}</td>
                        <td><span>{bjTime(lead.startTime, false)} — {bjTime(lead.endTime, false)}</span><small className="cell-secondary">{bjTime(lead.startTime).slice(0, 5)}</small></td>
                        <td>{lead.minSimilarity === null ? '—' : lead.minSimilarity.toFixed(4)}</td>
                        <td><Badge kind={leadStatusKind(lead.reviewStatus)} dot>{leadStatusNames[lead.reviewStatus]}</Badge></td>
                        <td className="align-right"><button className="text-link" onClick={() => setOpenId(lead.id)}>查看<ChevronRight size={14}/></button></td>
                    </tr>)}</tbody>
                </table>
                {loading && !data && <div className="loading-block"><Spinner text="正在读取协同线索"/></div>}
                {!loading && data && !data.items.length && <Empty title="没有匹配的线索" text="调整筛选条件,或清空关键词后重试。"/>}
            </div>
            <div className="table-footer">
                <span>共 {data?.total ?? 0} 条 · 第 {page} / {pages} 页</span>
                <div className="pagination">
                    <button className="icon-button" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} aria-label="上一页"><ChevronLeft size={16}/></button>
                    <button className="icon-button" disabled={page >= pages} onClick={() => setPage(p => Math.min(pages, p + 1))} aria-label="下一页"><ChevronRight size={16}/></button>
                </div>
            </div>
        </section>
        {openId && <LeadDrawer id={openId} canEdit={p.canEdit} notify={p.notify} onOpenLead={next => setOpenId(next)} onClose={() => { setOpenId(null); load(); }}/>}
    </>;
}

interface EventGraph {
    nodes: { id: string; uid: string; text: string; time: number | null; likes: number; replyTo: string | null; leadIds: number[] }[];
    replyEdges: { source: string; target: string }[];
    groups: { leadId: number; representative: string | null; members: string[]; starEdges: { source: string; target: string; similarity: number | null }[] }[];
}

function LeadDrawer({ id, canEdit, notify, onOpenLead, onClose }: { id: string; canEdit: boolean; notify: (text: string, type?: 'success' | 'error') => void; onOpenLead: (id: string) => void; onClose: () => void }) {
    const [accountLeads, setAccountLeads] = useState<{ key: string; items: CoordinationLead[] } | null>(null);
    const [accountLoading, setAccountLoading] = useState('');
    const [lead, setLead] = useState<LeadDetail | null>(null);
    const [event, setEvent] = useState<EventDetail | null>(null);
    const [graph, setGraph] = useState<EventGraph | null>(null);
    const [selectedNode, setSelectedNode] = useState<string | null>(null);
    const [showWholeEvent, setShowWholeEvent] = useState(false);
    const [error, setError] = useState('');
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape')
            onClose(); };
        document.addEventListener('keydown', onKey);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previousOverflow; };
    }, [onClose]);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const detail = await api<LeadDetail>('/leads/' + id);
                if (!alive)
                    return;
                setLead(detail);
                setNote(detail.reviewNote);
                const [ev, g] = await Promise.all([
                    api<EventDetail>('/events/' + detail.eventId).catch(() => null),
                    api<EventGraph>('/events/' + detail.eventId + '/graph').catch(() => null),
                ]);
                if (!alive)
                    return;
                setEvent(ev);
                setGraph(g);
            }
            catch (e) {
                if (alive)
                    setError(e instanceof Error ? e.message : '线索详情加载失败');
            }
        })();
        return () => { alive = false; };
    }, [id]);

    async function review(status: LeadReviewStatus) {
        if (!note.trim()) {
            notify('请先填写复核依据', 'error');
            return;
        }
        setSaving(true);
        try {
            const updated = await api<LeadDetail>('/leads/' + id + '/review', { status, note });
            setLead(updated);
            notify(`线索已标记为「${leadStatusNames[status]}」`);
        }
        catch (e) {
            notify(e instanceof Error ? e.message : '复核保存失败', 'error');
        }
        finally {
            setSaving(false);
        }
    }

    const layout = useMemo(() => {
        if (!lead || !graph)
            return null;
        const repNode = lead.comments.find(c => c.rep)?.node || null;
        const memberNodes = new Set(lead.members.map(m => m.nodeKey).filter(Boolean) as string[]);
        const activeGroup = graph.groups.find(g => g.representative && g.representative === repNode)
            ?? graph.groups.find(g => g.members.some(m => memberNodes.has(m)));
        const keep = showWholeEvent ? null : new Set(activeGroup?.members?.length ? activeGroup.members : [...memberNodes]);
        const nodes = graph.nodes.filter(n => (keep ? keep.has(n.id) : true) && (showWholeEvent ? n.leadIds.length > 0 : true));
        const index = new Map(nodes.map((n, i) => [n.id, i]));
        const center = repNode && index.has(repNode) ? repNode : nodes[0]?.id ?? null;
        const others = nodes.filter(n => n.id !== center);
        const placed = new Map<string, { x: number; y: number }>();
        if (center)
            placed.set(center, { x: 320, y: 230 });
        const radius = Math.min(215, 105 + others.length * 2.2);
        others.forEach((n, i) => {
            const angle = (Math.PI * 2 * i) / Math.max(1, others.length) - Math.PI / 2;
            placed.set(n.id, { x: 320 + Math.cos(angle) * radius, y: 230 + Math.sin(angle) * (radius * 0.86) });
        });
        const replies = graph.replyEdges.filter(e => placed.has(e.source) && placed.has(e.target));
        const sims = (activeGroup?.starEdges ?? []).filter(e => placed.has(e.source) && placed.has(e.target));
        return { nodes, placed, center, replies, sims, total: graph.nodes.length };
    }, [lead, graph, showWholeEvent]);

    const activeNode = layout?.nodes.find(n => n.id === selectedNode) ?? null;

    return <div className="modal-backdrop drawer-backdrop" onMouseDown={e => { if (e.target === e.currentTarget)
        onClose(); }}>
        <div className="modal drawer" role="dialog" aria-modal="true" aria-label="线索详情">
            <div className="modal-head">
                <div><h2>线索 {id}</h2><p>{lead ? `${lead.eventRef} · ${lead.accountCount} 账号 / ${lead.commentCount} 评论 · ${bjTime(lead.startTime)} — ${bjTime(lead.endTime)}` : '正在读取…'}</p></div>
                <button className="icon-button" aria-label="关闭" onClick={onClose}>×</button>
            </div>
            <div className="modal-body">
                {error && <div className="inline-error"><AlertCircle size={16}/>{error}</div>}
                {!lead && !error && <div className="loading-block"><Spinner text="正在读取线索"/></div>}
                {lead && <>
                    <div className="callout"><span>相似边是文本表达接近(<strong>虚线</strong>),回复边来自原始回复关系(<strong>实线</strong>)。代表评论是相似计算的起点,不等于"组织者"。</span></div>
                    <div className="graph-header-info">
                        <div className="graph-stat-pair"><span>群组账号</span><strong>{lead.accountCount}</strong></div>
                        <div className="graph-stat-pair"><span>群组评论</span><strong>{lead.commentCount}</strong></div>
                        <div className="graph-stat-pair"><span>最小相似度</span><strong>{lead.minSimilarity?.toFixed(4) ?? '—'}</strong></div>
                        <div className="graph-controls"><button className="button button-soft" onClick={() => setShowWholeEvent(v => !v)}>{showWholeEvent ? '只看该群组' : '展开整个事件'}</button></div>
                    </div>
                    {layout ? <div className="graph-layout" style={{ gridTemplateColumns: '1fr' }}>
                        <div className="graph-canvas">
                            <svg className="network-svg" viewBox="0 0 640 460" role="img" aria-label="事件交互图">
                                <rect x="0" y="0" width="640" height="460" fill="transparent"/>
                                {layout.sims.map((e, i) => <line key={'s' + i} x1={layout.placed.get(e.source)!.x} y1={layout.placed.get(e.source)!.y} x2={layout.placed.get(e.target)!.x} y2={layout.placed.get(e.target)!.y} stroke="currentColor" strokeOpacity="0.28" strokeWidth="1" strokeDasharray="4 4"/>)}
                                {layout.replies.map((e, i) => <line key={'r' + i} x1={layout.placed.get(e.source)!.x} y1={layout.placed.get(e.source)!.y} x2={layout.placed.get(e.target)!.x} y2={layout.placed.get(e.target)!.y} stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.4"/>)}
                                {layout.nodes.map(n => {
                                    const pos = layout.placed.get(n.id)!;
                                    const isRep = layout.center === n.id;
                                    const active = selectedNode === n.id;
                                    return <g key={n.id} onClick={() => setSelectedNode(n.id)} style={{ cursor: 'pointer' }}>
                                        <circle cx={pos.x} cy={pos.y} r={isRep ? 9 : 5.5} fill={isRep ? '#e05a4f' : active ? '#2f7d7a' : '#4c86c6'} fillOpacity={active || isRep ? 1 : 0.78}/>
                                        {isRep && <circle cx={pos.x} cy={pos.y} r={14} fill="none" stroke="#e05a4f" strokeOpacity="0.45"/>}
                                    </g>;
                                })}
                            </svg>
                            <div className="graph-legend">
                                <span><i style={{ background: '#e05a4f' }}/>代表评论</span>
                                <span><i style={{ background: '#4c86c6' }}/>成员评论</span>
                                <span>{showWholeEvent ? `事件线索节点 ${layout.nodes.length}/${layout.total}` : '实线回复 · 虚线相似'}</span>
                            </div>
                        </div>
                        <aside className="graph-inspector" style={{ borderLeft: 'none', borderTop: '1px solid #e9f0f2' }}>
                            {activeNode ? <div className="detail-section">
                                <span className="tiny-label">评论原文</span>
                                <p>{activeNode.text}</p>
                                <div className="key-value-row"><span>来源账号键</span><strong className="mono">{activeNode.uid}</strong></div>
                                <div className="key-value-row"><span>发布时间</span><strong>{bjTime(activeNode.time)}{activeNode.time ? ' (北京时间)' : ''}</strong></div>
                                <div className="key-value-row"><span>点赞数</span><strong>{activeNode.likes}</strong></div>
                                <div className="key-value-row"><span>节点定位</span><strong className="mono">{activeNode.id}</strong></div>
                                {activeNode.replyTo && <div className="key-value-row"><span>回复目标</span><strong className="mono">{activeNode.replyTo}</strong></div>}
                            </div> : <div className="detail-empty">点击图中节点查看 UID、发布时间和评论原文。</div>}
                        </aside>
                    </div> : <div className="graph-empty-icon">事件图谱未加载(静态资源缺失),下方成员表与原文列表仍可追溯。</div>}

                    <section className="detail-section">
                        <SectionTitle title="成员表" subtitle="一个来源账号键对应一个成员;同一条评论可能出现在多个群组。"/>
                        <div className="table-scroll"><table className="data-table"><thead><tr><th>来源账号键</th><th>评论数</th><th>首次</th><th>最近</th><th>备注</th></tr></thead>
                            <tbody>{lead.members.map(m => <tr key={m.memberKey}><td className="mono">{m.memberKey}</td><td>{m.commentCount}</td><td>{bjTime(m.firstTime)}</td><td>{bjTime(m.lastTime)}</td><td>{m.isRepresentative ? <Badge kind="red">代表评论作者</Badge> : '—'}</td><td className="align-right"><button className="text-link" disabled={accountLoading === m.memberKey} onClick={async () => {
                                setAccountLoading(m.memberKey);
                                try {
                                    const found = await api<{ accountKey: string; leads: CoordinationLead[] }>('/leads/account?key=' + encodeURIComponent(m.memberKey) + '&namespace=coordination');
                                    setAccountLeads({ key: m.memberKey, items: found.leads });
                                }
                                catch (e) {
                                    notify(e instanceof Error ? e.message : '查询失败', 'error');
                                }
                                finally {
                                    setAccountLoading('');
                                }
                            }}>相关线索<ChevronRight size={13}/></button></td></tr>)}</tbody></table></div>
                        {accountLeads && <>
                            <div className="inline-stats">
                                <span>账号 <strong className="mono">{accountLeads.key}</strong></span>
                                <span>出现于 <strong>{accountLeads.items.length}</strong> 组线索</span>
                                <button className="text-link" onClick={() => setAccountLeads(null)}>收起</button>
                            </div>
                            {accountLeads.items.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>线索</th><th>来源事件</th><th>账号数</th><th>评论数</th><th>复核状态</th><th className="align-right">操作</th></tr></thead>
                                <tbody>{accountLeads.items.map(other => <tr key={other.id}><td className="mono">{other.id}</td><td className="mono">{other.eventRef}</td><td>{other.accountCount}</td><td>{other.commentCount}</td><td><Badge kind={leadStatusKind(other.reviewStatus)}>{leadStatusNames[other.reviewStatus as LeadReviewStatus]}</Badge></td><td className="align-right">{other.id === id ? <span className="muted small-text">当前</span> : <button className="text-link" onClick={() => { setAccountLeads(null); onOpenLead(other.id); }}>打开<ChevronRight size={13}/></button>}</td></tr>)}</tbody></table></div>
                                : <p className="source-caption">这个账号在当前批次里只出现在本组线索中(只在本来源命名空间内匹配,不做跨平台合并)。</p>}
                        </>}
                    </section>

                    <section className="detail-section">
                        <SectionTitle title="原始评论" subtitle="按时间排序,保留节点定位以便回查来源文件。" />
                        <div className="table-scroll"><table className="data-table"><thead><tr><th>时间(北京时间)</th><th>来源账号键</th><th>原文</th><th>定位</th></tr></thead>
                            <tbody>{[...lead.comments].sort((a, b) => (a.time ?? 0) - (b.time ?? 0)).map((c, i) => <tr key={i}><td>{bjTime(c.time)}</td><td className="mono">{c.uid}</td><td>{c.text}</td><td className="mono">{c.node ?? '—'}{c.rep ? ' · 代表' : ''}</td></tr>)}</tbody></table></div>
                    </section>

                    <section className="detail-section">
                        <SectionTitle title="人工复核" subtitle="复核结论与运行版本一起保存,改参数重跑不会套用旧结论。"/>
                        <div className="field-grid">
                            <label className="field"><span>复核依据</span><textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="例如:同一时间窗内多条文本高度一致,来源账号集中在同一事件,建议移交人工核查。"/></label>
                        </div>
                        <div className="modal-actions">
                            <span className="muted">当前状态:{leadStatusNames[lead.reviewStatus]}{lead.reviewerName ? ` · ${lead.reviewerName} ${prettyDate(lead.reviewedAt)}` : ''}</span>
                            <div className="filter-group">
                                <button className="button button-soft" disabled={!canEdit || saving} onClick={() => review('following')}>保留观察</button>
                                <button className="button button-soft" disabled={!canEdit || saving} onClick={() => review('dismissed')}>排除线索</button>
                                <button className="button button-primary" disabled={!canEdit || saving} onClick={() => review('confirmed')}>确认线索</button>
                            </div>
                        </div>
                        {event && <p className="source-caption">事件共 {event.event.nodeCount} 个节点、{event.event.replyCount} 条回复边、{event.leads.length} 组线索;图谱中展示的是其中一组。</p>}
                    </section>
                </>}
            </div>
        </div>
    </div>;
}

// ---------- 评论检测 ----------

interface PredictionHistoryItem {
    id: string;
    content?: string;
    rawScore: number | null;
    label: string;
    riskLevel: string;
    confidence: string;
    runId: string;
    modelVersion: string;
    createdAt: string;
    status: string;
    error: string | null;
}

interface PredictionHistory {
    items: PredictionHistoryItem[];
    stats: { total: number; water: number; failed: number; runs: number };
}

interface DouyinStatus {
    batch: string;
    imported: boolean;
    works: number;
    comments: number;
    accounts: number;
    importedComments: number;
    timePrecision: string;
    note: string;
}

const SAMPLE_TEXTS = [
    '这事必须严查，转发让更多人看到！',
    '用啥铁丝组装的小玫瑰花？太漂亮了了',
    '支持国家严查网络水军，转发扩散！！！',
];

export function Screening(p: PanelProps) {
    const [single, setSingle] = useState(SAMPLE_TEXTS[0]);
    const [batch, setBatch] = useState(SAMPLE_TEXTS.join('\n'));
    const [result, setResult] = useState<ScreeningResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [history, setHistory] = useState<PredictionHistory | null>(null);
    const [douyin, setDouyin] = useState<DouyinStatus | null>(null);
    const [libPage, setLibPage] = useState(1);
    const [libQ, setLibQ] = useState('');
    const [libNs, setLibNs] = useState('');
    const [lib, setLib] = useState<{ items: CommentRecord[]; total: number; page: number; pageSize: number } | null>(null);
    const [libLoading, setLibLoading] = useState(false);

    const loadHistory = useCallback(async () => {
        try {
            setHistory(await api<PredictionHistory>('/screening/predictions?limit=30'));
        }
        catch { /* 历史列表失败不阻塞主流程 */ }
    }, []);
    const loadDouyin = useCallback(async () => {
        try {
            setDouyin(await api<DouyinStatus>('/imports/douyin'));
        }
        catch { /* 未导入时保持空 */ }
    }, []);

    const loadLibrary = useCallback(async () => {
        setLibLoading(true);
        try {
            const params = new URLSearchParams({ page: String(libPage), pageSize: '10' });
            if (libQ.trim())
                params.set('q', libQ.trim());
            if (libNs)
                params.set('namespace', libNs);
            setLib(await api<{ items: CommentRecord[]; total: number; page: number; pageSize: number }>('/comments?' + params.toString()));
        }
        catch { /* 库列表失败不阻塞筛查 */ }
        finally {
            setLibLoading(false);
        }
    }, [libPage, libQ, libNs]);

    useEffect(() => { loadHistory(); loadDouyin(); }, [loadHistory, loadDouyin]);
    useEffect(() => { loadLibrary(); }, [loadLibrary]);

    async function submit(texts: string[]) {
        const items = texts.map(t => t.trim()).filter(Boolean).map((content, i) => ({ content, commentId: `ui_${Date.now().toString(36)}_${i}` }));
        if (!items.length) {
            setError('请先输入评论内容');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const res = await api<ScreeningResult>('/screening/comments', { items });
            setResult(res);
            p.notify(`筛查完成:成功 ${res.persisted} 条,失败 ${res.failed} 条。`);
            await loadHistory();
            await loadLibrary();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : '筛查请求失败');
        }
        finally {
            setBusy(false);
        }
    }

    async function importDouyin() {
        setBusy(true);
        try {
            const res = await api<{ works: number; comments: number; accounts: number }>('/imports/douyin', {});
            p.notify(`抖音小样本已导入:作品 ${res.works} / 评论 ${res.comments} / 账号 ${res.accounts}。`);
            await loadDouyin();
        }
        catch (e) {
            p.notify(e instanceof Error ? e.message : '导入失败', 'error');
        }
        finally {
            setBusy(false);
        }
    }

    return <>
        <div className="notice-mark"><ShieldAlert size={17}/><span>分数是<strong>评论文本筛查分数</strong>,不是账号身份概率;confidence 仅由文本长度生成,不是统计置信度;evidence 是长度/标点/@/#/emoji 计数,不是模型归因。</span></div>
        <div className="dashboard-bottom" style={{ alignItems: 'start' }}>
            <section className="card">
                <SectionTitle title="单条检测" subtitle="调用服务端内置 WB01 文本模型,单条上限 1000 字,结果自动落库。"/>
                <label className="field"><span>评论原文</span><textarea rows={4} value={single} onChange={e => setSingle(e.target.value)} placeholder="粘贴一条评论文本"/></label>
                <div className="modal-actions"><span className="muted">模型 wb01-textonly-v1.0 · 阈值 0.5</span><button className="button button-primary" disabled={busy} onClick={() => submit([single])}><Play size={15}/>开始检测</button></div>
            </section>
            <section className="card">
                <SectionTitle title="批量检测" subtitle="每行一条,单次最多 200 条;空文本与超长条目逐条报错,不会变成 0 分。"/>
                <label className="field"><span>批量文本(每行一条)</span><textarea rows={4} value={batch} onChange={e => setBatch(e.target.value)} placeholder="每行一条评论"/></label>
                <div className="modal-actions"><span className="muted">{batch.split('\n').filter(l => l.trim()).length} 条待提交</span><button className="button button-primary" disabled={busy} onClick={() => submit(batch.split('\n'))}><Upload size={15}/>批量筛查</button></div>
            </section>
        </div>
        {error && <div className="inline-error"><AlertCircle size={16}/>{error}</div>}
        {result && <section className="card">
            <SectionTitle title="本次结果" subtitle={`运行 ${result.runId} · 模型 ${result.modelVersion} · 阈值 ${result.threshold}`} action={<Badge kind="blue">{result.persisted} 成功 / {result.failed} 失败</Badge>}/>
            <div className="table-scroll"><table className="data-table"><thead><tr><th>评论</th><th>筛查分数</th><th>标签</th><th>风险等级</th><th>文本可信度</th><th>证据计数</th></tr></thead>
                <tbody>{result.items.map((item, i) => <tr key={i}>
                    <td>{item.content || <span className="muted">(空文本)</span>}</td>
                    {item.status === 'ok' && item.prediction ? <>
                        <td><div className="score-value"><strong>{item.prediction.rawScore.toFixed(4)}</strong><span>/{item.prediction.threshold}</span></div></td>
                        <td><Badge kind={item.prediction.label === 'water' ? 'red' : 'teal'} dot>{item.prediction.label === 'water' ? '疑似水军文本' : '常规文本'}</Badge></td>
                        <td><Badge kind={riskKind(item.prediction.riskLevel)}>{riskNames[item.prediction.riskLevel] || item.prediction.riskLevel}</Badge></td>
                        <td>{item.prediction.confidence}</td>
                        <td className="mono small-text">{Object.entries(item.prediction.evidence).map(([k, v]) => `${k}:${v}`).join(' · ')}</td>
                    </> : <>
                        <td>—</td><td><Badge kind="neutral">未评分</Badge></td><td><Badge kind="neutral">无法判定</Badge></td>
                        <td>—</td><td className="inline-error">{item.error}</td>
                    </>}
                </tr>)}</tbody></table></div>
            <p className="source-caption">说明:{result.note}</p>
        </section>}
        <section className="card">
            <SectionTitle title="历史筛查记录" subtitle="刷新后仍可查;失败记录保留错误原因,分数留空。" action={<button className="button button-soft" onClick={loadHistory}><RefreshCw size={15}/>刷新</button>}/>
            {history && <div className="inline-stats"><span>累计记录 <strong>{history.stats.total}</strong></span><span>疑似文本 <strong>{history.stats.water}</strong></span><span>失败 <strong>{history.stats.failed}</strong></span><span>批次 <strong>{history.stats.runs}</strong></span></div>}
            <div className="table-scroll"><table className="data-table"><thead><tr><th>评论</th><th>分数</th><th>标签</th><th>运行批次</th><th>时间</th></tr></thead>
                <tbody>{(history?.items ?? []).map(item => <tr key={item.id}>
                    <td>{item.content?.slice(0, 60) || '—'}</td>
                    <td>{item.rawScore === null ? <span className="muted">—</span> : item.rawScore.toFixed(4)}</td>
                    <td>{item.status === 'error' ? <Badge kind="neutral">失败</Badge> : <Badge kind={item.label === 'water' ? 'red' : 'teal'} dot>{item.label === 'water' ? '疑似' : '常规'}</Badge>}</td>
                    <td className="mono small-text">{item.runId}</td>
                    <td>{prettyDate(item.createdAt)}</td>
                </tr>)}</tbody></table></div>
            {history && !history.items.length && <Empty title="还没有筛查记录" text="提交一条评论后,结果会保存在这里。"/>}
        </section>
        <section className="card">
            <SectionTitle title="评论库" subtitle="已入库的全部评论:协同线索批次、抖音小样本、手工筛查。可以直接挑一条重新检测。" action={<button className="button button-soft" onClick={loadLibrary}><RefreshCw size={15} className={libLoading ? 'spin' : ''}/>刷新</button>}/>
            <div className="table-toolbar filter-toolbar">
                <label className="search-input"><Search size={16}/><input value={libQ} onChange={e => { setLibPage(1); setLibQ(e.target.value); }} placeholder="搜索评论原文、昵称或账号键" aria-label="搜索评论"/></label>
                <div className="filter-group"><Filter size={15}/>
                    <select value={libNs} onChange={e => { setLibPage(1); setLibNs(e.target.value); }} aria-label="来源">
                        <option value="">全部来源</option>
                        <option value="coordination">协同线索批次</option>
                        <option value="douyin">抖音小样本</option>
                        <option value="manual">手工筛查</option>
                    </select>
                </div>
                <span className="muted small-text">共 {lib?.total ?? 0} 条</span>
            </div>
            <div className="table-scroll"><table className="data-table"><thead><tr><th>来源</th><th>作者 / 账号键</th><th>评论原文</th><th>时间</th><th>精度</th><th className="align-right">操作</th></tr></thead>
                <tbody>{(lib?.items ?? []).map(item => <tr key={item.id}>
                    <td><Badge kind={item.sourceNamespace === 'coordination' ? 'purple' : item.sourceNamespace === 'douyin' ? 'blue' : 'neutral'}>{item.sourceNamespace === 'coordination' ? '协同' : item.sourceNamespace === 'douyin' ? '抖音' : '手工'}</Badge></td>
                    <td>{item.authorName || '—'}<small className="cell-secondary mono">{item.sourceAccountKey.slice(0, 16)}{item.sourceAccountKey.length > 16 ? '…' : ''}</small></td>
                    <td className="small-text">{item.content.slice(0, 60)}{item.content.length > 60 ? '…' : ''}</td>
                    <td>{item.publishTime ? bjTime(item.publishTime) : '—'}</td>
                    <td>{item.timePrecision === 'approximate' ? '近似' : item.timePrecision === 'minute' ? '分钟' : '未知'}</td>
                    <td className="align-right"><button className="text-link" disabled={busy} onClick={() => submit([item.content])}>检测这条<ArrowRight size={13}/></button></td>
                </tr>)}</tbody></table></div>
            {(lib?.total ?? 0) > 10 && <div className="table-footer">
                <span>第 {libPage} / {Math.max(1, Math.ceil((lib?.total ?? 0) / 10))} 页</span>
                <div className="pagination">
                    <button className="icon-button" disabled={libPage <= 1} onClick={() => setLibPage(page2 => Math.max(1, page2 - 1))} aria-label="上一页"><ChevronLeft size={16}/></button>
                    <button className="icon-button" disabled={libPage >= Math.ceil((lib?.total ?? 0) / 10)} onClick={() => setLibPage(page2 => page2 + 1)} aria-label="下一页"><ChevronRight size={16}/></button>
                </div>
            </div>}
            {lib && !lib.items.length && <Empty title="没有匹配的评论" text="换个关键词,或清空来源筛选。"/>}
        </section>
        <section className="card">
            <SectionTitle title="抖音公开评论区小样本" subtitle="5 个作品 / 231 条评论 / 215 个账号;发布时间为相对时间推算的近似值。" action={<button className="button button-soft" disabled={busy} onClick={importDouyin}><Upload size={15}/>{douyin?.imported ? '重新校验导入' : '导入样本'}</button>}/>
            {douyin && <div className="inline-stats">
                <span>作品 <strong>{douyin.works}</strong></span>
                <span>评论 <strong>{douyin.comments}</strong></span>
                <span>账号 <strong>{douyin.accounts}</strong></span>
                <span>已入库评论 <strong>{douyin.importedComments}</strong></span>
                <span>时间精度 <strong>{douyin.timePrecision === 'approximate' ? '近似' : douyin.timePrecision}</strong></span>
            </div>}
            <p className="source-caption">{douyin?.note || '导入为幂等操作,重复执行不会翻倍。'}</p>
        </section>
    </>;
}

// ---------- 模型接入 ----------

const statusNames: Record<string, string> = { ready: '已就绪', degraded: '降级运行', not_ready: '未就绪', planned: '未接入' };
const statusKind = (status: string) => status === 'ready' ? 'teal' : status === 'degraded' ? 'amber' : status === 'planned' ? 'neutral' : 'red';

export function Models(p: PanelProps) {
    const [status, setStatus] = useState<ModelStatus | null>(null);
    const [error, setError] = useState('');
    const [checking, setChecking] = useState(false);
    const [check, setCheck] = useState<SelfCheckResult | null>(null);
    const [checkError, setCheckError] = useState('');

    useEffect(() => {
        api<ModelStatus>('/models/status').then(setStatus).catch(e => setError(e instanceof Error ? e.message : '状态加载失败'));
    }, []);

    async function runSelfCheck() {
        setChecking(true);
        setCheckError('');
        try {
            const result = await api<SelfCheckResult>('/models/selfcheck');
            setCheck(result);
            const failed = result.checks.filter(item => item.status === 'fail').length;
            p.notify(failed ? `自检完成:${failed} 项未通过` : '自检完成:可运行能力全部通过', failed ? 'error' : 'success');
        }
        catch (e) {
            setCheckError(e instanceof Error ? e.message : '自检失败');
        }
        finally {
            setChecking(false);
        }
    }

    function downloadStatus() {
        if (!status)
            return;
        const payload = { exportedAt: new Date().toISOString(), status, selfCheck: check };
        downloadText('清源-能力清单.json', JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
        p.notify('能力清单已下载。');
    }

    if (error)
        return <div className="inline-error"><AlertCircle size={16}/>{error}</div>;
    if (!status)
        return <div className="loading-block"><Spinner text="正在读取模型状态"/></div>;

    const actionOf: Record<string, { label: string; run: () => void } | null> = {
        comment_classification: { label: '去评论检测', run: () => p.go('screening') },
        coordination_lookup: { label: '去协同线索', run: () => p.go('leads') },
        coordination_scan: { label: '去事件扫描', run: () => p.go('scan') },
        behavior_baseline: { label: '去摸排任务', run: () => p.go('tasks') },
        account_bert: null,
    };
    const checkOf = (key: string) => check?.checks.find(item => item.key === key);

    return <>
        <div className="notice-mark"><GitBranch size={17}/><span>五种能力<strong>分开</strong>计价与展示:评论文本筛查、协同线索查询、新事件在线扫描、账号 BERT、行为规则基线。它们不会拼成一个"总水军概率"。</span></div>
        <section className="card">
            <SectionTitle title="能力自检" subtitle="真的跑一遍:文本模型跑探针、线索查询真查库、在线扫描用 5 条合成评论跑一次内存扫描(不落库)。" action={<div className="filter-group"><button className="button button-primary" disabled={checking} onClick={runSelfCheck}>{checking ? <><RefreshCw size={15} className="spin"/>自检中</> : <><Play size={15}/>运行自检</>}</button><button className="button button-soft" onClick={downloadStatus}><Download size={15}/>下载能力清单</button></div>}/>
            {checkError && <div className="inline-error"><AlertCircle size={16}/>{checkError}</div>}
            {check ? <div className="table-scroll"><table className="data-table"><thead><tr><th>能力</th><th>结果</th><th>耗时</th><th>实测说明</th></tr></thead>
                <tbody>{check.checks.map(item => <tr key={item.key}>
                    <td><strong>{item.name}</strong><small className="cell-secondary mono">{item.key}</small></td>
                    <td><Badge kind={item.status === 'pass' ? 'teal' : item.status === 'fail' ? 'red' : 'neutral'} dot>{item.status === 'pass' ? '通过' : item.status === 'fail' ? '失败' : '未就绪'}</Badge></td>
                    <td>{item.latencyMs ? `${item.latencyMs} ms` : '—'}</td>
                    <td className="small-text">{item.detail}</td>
                </tr>)}</tbody></table></div>
                : <p className="source-caption">点「运行自检」会用当前服务端数据实际跑一次,结果只用于确认能力可用,不写库。</p>}
            {check && <p className="source-caption">自检时间 {new Date(check.ranAt).toLocaleString('zh-CN', { hour12: false })}</p>}
        </section>
        <div className="integration-grid">
            {status.capabilities.map(cap => {
                const probe = checkOf(cap.key);
                const action = actionOf[cap.key];
                return <section className="card integration-card" key={cap.key}>
                    <div className="integration-card-head">
                        <div><span className="tiny-label mono">{cap.key}</span><h3>{cap.name}</h3></div>
                        <Badge kind={statusKind(cap.status)} dot>{statusNames[cap.status] || cap.status}</Badge>
                    </div>
                    <p>{cap.detail}</p>
                    <div className="integration-card-foot">
                        <span className="mono small-text">{cap.contract}</span>
                        <span className="muted">版本 {cap.version}</span>
                    </div>
                    <div className="integration-card-foot">
                        {probe ? <span className="small-text">自检:{probe.status === 'pass' ? '通过' : probe.status === 'fail' ? '失败' : '未就绪'}{probe.latencyMs ? ` · ${probe.latencyMs}ms` : ''}</span> : <span className="small-text muted">未自检</span>}
                        {action && <button className="text-link" onClick={action.run}>{action.label}<ArrowRight size={14}/></button>}
                    </div>
                </section>;
            })}
        </div>
        <div className="dashboard-bottom" style={{ alignItems: 'start' }}>
            <section className="card">
                <SectionTitle title="WB01 文本模型" subtitle="服务端内置推理,权重随代码打包,不经过浏览器。" action={<Badge kind="teal" dot>已就绪</Badge>}/>
                <div className="key-value-row"><span>模型版本</span><strong className="mono">{status.wb01.modelVersion}</strong></div>
                <div className="key-value-row"><span>特征</span><strong>{status.wb01.features}</strong></div>
                <div className="key-value-row"><span>维度 / 阈值</span><strong>{status.wb01.dimension} / {status.wb01.threshold}</strong></div>
                <div className="key-value-row"><span>单次上限</span><strong>{status.wb01.maxBatch} 条 · 单条 {status.wb01.maxLength} 字</strong></div>
                <div className="key-value-row"><span>训练样本</span><strong>{status.wb01.trainSize ?? '—'}</strong></div>
                <p className="source-caption">{status.wb01.note}</p>
                <div className="filter-group"><button className="button button-soft" onClick={() => p.go('screening')}><Play size={15}/>去测一条评论</button></div>
            </section>
            <section className="card">
                <SectionTitle title="协同线索批次" subtitle="预计算离线结果,本站只做读取、复核与导出。" action={<Badge kind="teal" dot>已就绪</Badge>}/>
                <div className="key-value-row"><span>运行批次</span><strong className="mono">{status.coordination.runId}</strong></div>
                <div className="key-value-row"><span>数据版本</span><strong>{status.coordination.version}</strong></div>
                <div className="key-value-row"><span>线索 / 事件</span><strong>{status.coordination.leads} / {status.coordination.events}</strong></div>
                <p className="source-caption">{status.coordination.note}</p>
                <div className="filter-group"><button className="button button-soft" onClick={() => p.go('leads')}>查看线索<ArrowRight size={14}/></button><button className="button button-soft" onClick={() => p.go('scan')}>跑一次扫描<ArrowRight size={14}/></button></div>
            </section>
        </div>
        <section className="card">
            <SectionTitle title="数据批次" subtitle="导入批次可重复执行,幂等键保证不翻倍。" action={<button className="button button-soft" onClick={() => p.go('datasets')}>去数据集<ArrowRight size={14}/></button>}/>
            <div className="key-value-row"><span>抖音小样本</span><strong className="mono">{status.dataset.batch}</strong></div>
            <div className="key-value-row"><span>作品 / 评论 / 账号</span><strong>{status.dataset.works} / {status.dataset.comments} / {status.dataset.accounts}</strong></div>
            <div className="key-value-row"><span>是否已入库</span><strong>{status.dataset.imported ? '已导入' : '未导入'}</strong></div>
            <p className="source-caption">{status.dataset.note}</p>
        </section>
        <section className="card">
            <SectionTitle title="使用边界" subtitle="面向受控试用的口径说明。"/>
            <ul className="reason-list">{status.disclaimers.map((text, i) => <li key={i}><AlertCircle size={15}/>{text}</li>)}</ul>
            <p className="source-caption">完整评估与缺失材料见《ClearTrace 模型接入与试用版规划》第 10 节;正式试用前需补独立测试集、完整短句词典与 BERT 权重。</p>
        </section>
    </>;
}

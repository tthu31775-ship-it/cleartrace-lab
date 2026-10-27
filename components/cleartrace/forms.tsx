'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowDownToLine, ArrowRight, CheckCircle2, CheckCheck, ChevronRight, Clock3, Database, FileJson, FileSpreadsheet, FileUp, Info, ListChecks, LoaderCircle, Play, Plus, RefreshCw, ShieldCheck, Upload, UserPlus, X } from 'lucide-react';
import type { Account, Bootstrap, Dataset, DatasetOverview, ImportResult, Member, ReviewStatus, Role, Task } from '@/lib/contracts';
type DatasetDetailPayload = { dataset: Dataset; overview: DatasetOverview; accounts: Account[]; comments: import('@/lib/contracts').CommentRecord[]; leads: import('@/lib/contracts').CoordinationLead[] };
import { api, Badge, date, downloadText, Empty, fmt, Modal, RiskBadge, roleNames, reviewNames, Spinner, TaskBadge } from './common';
const csvTemplate = 'account_id,display_name,platform,posts_count,followers_count,following_count,account_age_days,duplicate_ratio,burst_ratio,night_ratio,avg_interval_seconds,related_ids\nsample_001,样例账号一,公开样例,120,40,180,30,0.72,0.65,0.2,45,sample_002\nsample_002,样例账号二,公开样例,35,80,50,365,0.05,0.08,0.15,1200,sample_001\n';
const jsonTemplate = JSON.stringify([{ account_id: 'sample_001', display_name: '样例账号一', platform: '公开样例', posts_count: 120, followers_count: 40, following_count: 180, account_age_days: 30, duplicate_ratio: 0.72, burst_ratio: 0.65, night_ratio: 0.2, avg_interval_seconds: 45, related_ids: ['sample_002'] }, { account_id: 'sample_002', display_name: '样例账号二', platform: '公开样例', posts_count: 35, followers_count: 80, following_count: 50, account_age_days: 365, duplicate_ratio: 0.05, burst_ratio: 0.08, night_ratio: 0.15, avg_interval_seconds: 1200, related_ids: ['sample_001'] }], null, 2);
export function ImportModal({ onClose, onSuccess }: {
    onClose: () => void;
    onSuccess: (message: string) => Promise<void>;
}) {
    const [name, setName] = useState('');
    const [source, setSource] = useState('数据组交付');
    const [format, setFormat] = useState<'csv' | 'json'>('csv');
    const [content, setContent] = useState('');
    const [filename, setFilename] = useState('');
    const [preview, setPreview] = useState<ImportResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);
    const reset = () => { setPreview(null); setError(''); };
    async function file(file?: File) { if (!file)
        return; if (file.size > 5 * 1024 * 1024) {
        setError('文件超过 5 MB，请拆分后导入。');
        return;
    } const ext = file.name.split('.').pop()?.toLowerCase(); if (ext !== 'csv' && ext !== 'json') {
        setError('请选择 CSV 或 JSON 文件。');
        return;
    } setFormat(ext); setContent(await file.text()); setFilename(file.name); if (!name)
        setName(file.name.replace(/\.[^.]+$/, '')); reset(); }
    async function submit(dryRun: boolean) { setError(''); if (!name.trim()) {
        setError('请填写数据集名称。');
        return;
    } if (!content.trim()) {
        setError('请上传文件或粘贴数据内容。');
        return;
    } setBusy(true); try {
        const result = await api<ImportResult>('/datasets/import', { name: name.trim(), source: source.trim() || '数据组交付', format, content, dryRun });
        setPreview(result);
        if (!dryRun && result.dataset) {
            await onSuccess(`已导入 ${result.accepted} 条账号记录，数据集已保存。`);
            onClose();
        }
    }
    catch (e) {
        setError(e instanceof Error ? e.message : '导入失败');
    }
    finally {
        setBusy(false);
    } }
    return <Modal title="导入数据集" subtitle="先校验数据，再保存为独立数据集版本。" wide onClose={onClose}><div className="stepper"><span className="active"><b>1</b>准备数据</span><i /><span className={preview ? 'active' : ''}><b>2</b>校验预览</span><i /><span><b>3</b>确认导入</span></div><div className="form-grid"><label className="field"><span>数据集名称 <em>*</em></span><input value={name} maxLength={100} onChange={e => { setName(e.target.value); reset(); }} placeholder="例如：电商评论账号样本 v1"/></label><label className="field"><span>数据来源</span><input value={source} maxLength={100} onChange={e => { setSource(e.target.value); reset(); }} placeholder="例如：数据组交付"/></label></div><div className="format-selector"><span>数据格式</span><div className="segmented"><button className={format === 'csv' ? 'active' : ''} onClick={() => { setFormat('csv'); reset(); }}><FileSpreadsheet size={15}/>CSV</button><button className={format === 'json' ? 'active' : ''} onClick={() => { setFormat('json'); reset(); }}><FileJson size={15}/>JSON</button></div><button className="text-link" onClick={() => downloadText('cleartrace-template.' + format, format === 'csv' ? csvTemplate : jsonTemplate, format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json')}><ArrowDownToLine size={14}/>下载模板</button></div><input ref={fileRef} type="file" accept=".csv,.json" className="sr-only" onChange={e => file(e.target.files?.[0])}/><button className="file-drop" onClick={() => fileRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); file(e.dataTransfer.files[0]); }}><span className="file-drop-icon"><FileUp size={24}/></span><strong>{filename || '点击选择文件，或拖拽到这里'}</strong><span>{filename ? '已读取文件，可在下方检查内容' : '支持 CSV / JSON，单文件最多 5 MB'}</span></button><label className="field"><span>数据内容 <small>也可以直接粘贴</small></span><textarea className="code-input" rows={5} value={content} onChange={e => { setContent(e.target.value); setFilename(''); reset(); }} placeholder={format === 'csv' ? 'account_id,display_name,platform,posts_count,...' : '[{ "account_id": "sample_001", "display_name": "样例账号", ... }]'}/></label>{error && <div className="inline-error"><AlertCircle size={17}/>{error}</div>}{preview && <div className="import-preview"><div className={'validation-banner ' + (preview.valid ? 'valid' : 'invalid')}>{preview.valid ? <CheckCircle2 size={18}/> : <AlertCircle size={18}/>}<div><strong>{preview.valid ? '数据校验通过' : '请修复以下数据问题'}</strong><span>共 {preview.rows} 行 · 可导入 {preview.accepted} 行 · 重复 {preview.duplicateCount} 行</span></div></div>{preview.errors.length > 0 && <ul className="validation-errors">{preview.errors.slice(0, 8).map((e, i) => <li key={i}>第 {e.row} 行：{e.message}</li>)}{preview.errors.length > 8 && <li>还有 {preview.errors.length - 8} 项问题</li>}</ul>}{preview.preview.length > 0 && <div className="table-scroll"><table className="data-table preview-table"><thead><tr><th>账号 ID</th><th>显示名称</th><th>平台</th><th>发帖数</th><th>重复比例</th></tr></thead><tbody>{preview.preview.slice(0, 5).map((a, i) => <tr key={i}><td className="mono">{a.accountId}</td><td>{a.displayName}</td><td>{a.platform}</td><td>{a.postsCount}</td><td>{Math.round((a.duplicateRatio || 0) * 100)}%</td></tr>)}</tbody></table></div>}</div>}<div className="modal-actions"><span className="muted small-text">同一数据集内的重复账号自动去重</span><button className="button" disabled={busy} onClick={onClose}>取消</button>{preview?.valid ? <button className="button button-primary" disabled={busy || !preview.accepted} onClick={() => submit(false)}>{busy ? <Spinner text="正在导入"/> : <><CheckCheck size={16}/>确认导入 {preview.accepted} 条</>}</button> : <button className="button button-primary" disabled={busy} onClick={() => submit(true)}>{busy ? <Spinner text="正在校验"/> : <><ShieldCheck size={16}/>校验并预览</>}</button>}</div></Modal>;
}
export function NewTaskModal({ data, onClose, onCreated, defaultDataset }: {
    data: Bootstrap;
    onClose: () => void;
    onCreated: (task: Task, run: boolean) => Promise<void>;
    defaultDataset?: string;
}) {
    const [name, setName] = useState('');
    const [datasetId, setDatasetId] = useState(defaultDataset || data.datasets[0]?.id || '');
    const [modelId, setModelId] = useState('baseline-v1');
    const [threshold, setThreshold] = useState(65);
    const [autorun, setAutorun] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const ds = data.datasets.find(d => d.id === datasetId);
    async function submit(e: React.FormEvent) { e.preventDefault(); setError(''); if (!datasetId) {
        setError('请先导入一个数据集。');
        return;
    } setBusy(true); try {
        const task = await api<Task>('/tasks', { name: name.trim(), datasetId, modelId, threshold });
        onClose();
        await onCreated(task, autorun);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : '任务创建失败');
    }
    finally {
        setBusy(false);
    } }
    return <Modal title="新建摸排任务" subtitle="选择数据与模型，结果将保存为可追溯的独立任务。" onClose={onClose}><form onSubmit={submit}><label className="field"><span>任务名称 <em>*</em></span><input autoFocus required value={name} maxLength={100} onChange={e => setName(e.target.value)} placeholder="例如：电商评论异常行为排查"/></label><label className="field"><span>选择数据集 <em>*</em></span><select required value={datasetId} onChange={e => setDatasetId(e.target.value)}>{!data.datasets.length && <option value="">暂无数据集，请先导入</option>}{data.datasets.map(d => <option key={d.id} value={d.id}>{d.name} · {d.recordCount} 条</option>)}</select></label>{ds && <div className="selected-dataset"><Database size={18}/><span>{ds.recordCount} 条账号记录 <b>·</b> {ds.version} <b>·</b> {ds.source}</span>{ds.demo && <Badge>合成样例</Badge>}</div>}<label className="field"><span>识别模型</span><select value={modelId} onChange={e => setModelId(e.target.value)}><option value="baseline-v1">规则基线 v1.0 · 已就绪</option><option value="external">外部识别模型 · 需服务端配置</option></select><small>{modelId === 'baseline-v1' ? '根据行为特征计算可解释的规则评分，适用于联调与基础筛查。' : '调用算法组的 HTTPS 推理服务，未配置时任务会明确报告错误。'}</small></label><label className="field"><span>候选异常阈值 <strong className="threshold-value">{threshold}<small>/100</small></strong></span><input type="range" min="30" max="95" value={threshold} onChange={e => setThreshold(Number(e.target.value))}/><div className="range-labels"><span>较低：更多候选</span><span>较高：更严格</span></div></label><label className="checkbox-field"><input type="checkbox" checked={autorun} onChange={e => setAutorun(e.target.checked)}/><span>创建后立即执行任务<small>取消勾选后，任务保留在待执行队列。</small></span></label>{error && <div className="inline-error"><AlertCircle size={17}/>{error}</div>}<div className="modal-actions"><button type="button" className="button" onClick={onClose} disabled={busy}>取消</button><button type="submit" className="button button-primary" disabled={busy || !datasetId}>{busy ? <Spinner text="提交中"/> : <><Plus size={17}/>创建任务</>}</button></div></form></Modal>;
}
export function TaskDetail({ task, accounts, onClose, onAccount, onRun, onExport, onCancel, busy, canEdit }: {
    task: Task;
    accounts: Account[];
    onClose: () => void;
    onAccount: (a: Account) => void;
    onRun: (t: Task) => void;
    onExport: (t: Task) => void;
    onCancel: (t: Task) => void;
    busy: boolean;
    canEdit: boolean;
}) {
    const [confirmCancel, setConfirmCancel] = useState(false);
    const [results, setResults] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    useEffect(() => { let active = true; setLoading(true); api<{
        task: Task;
        results: Account[];
    }>('/tasks/' + task.id).then(r => { if (active)
        setResults(r.results); }).catch(e => { if (active)
        setError(e.message); }).finally(() => { if (active)
        setLoading(false); }); return () => { active = false; }; }, [task.id, task.status, task.attempt]);
    const rows = results.filter(a => (a.displayName + a.accountId).includes(search));
    return <Modal title={task.name} subtitle={task.id} wide onClose={onClose}><div className="detail-status"><TaskBadge status={task.status}/><Badge>{task.modelName}</Badge>{task.demo && <Badge>合成样例任务</Badge>}<span>{date(task.createdAt)}</span></div><div className="task-detail-stats"><div><span>检测账号</span><strong>{fmt(task.total)}</strong></div><div><span>已处理</span><strong>{fmt(task.processed)}</strong></div><div><span>候选异常</span><strong className="amber-text">{task.suspectedCount}</strong></div><div><span>识别阈值</span><strong>{task.threshold}<small>/100</small></strong></div></div><div className="task-progress-detail"><div><span>{task.datasetName}</span><strong>{task.progress}%</strong></div><div className="progress-track"><i style={{ width: task.progress + '%' }}/></div></div><div className="task-timeline"><span><Clock3 size={14}/>开始：{task.startedAt ? date(task.startedAt) : '尚未开始'}</span><span><CheckCircle2 size={14}/>完成：{task.completedAt ? date(task.completedAt) : '尚未完成'}</span><span>执行次数：{task.attempt}</span></div>{task.error && <div className="inline-error"><AlertCircle size={17}/><div><strong>执行失败</strong><p>{task.error}</p></div></div>}<div className="detail-results-head"><h3>识别结果 <Badge>{results.length}</Badge></h3><input className="compact-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索本次结果"/></div>{loading ? <div className="loading-block"><Spinner /></div> : error ? <div className="inline-error">{error}</div> : rows.length ? <div className="table-scroll detail-result-scroll"><table className="data-table"><thead><tr><th>账号</th><th>评分</th><th>风险等级</th><th>识别说明</th><th /></tr></thead><tbody>{rows.map(a => <tr key={a.id}><td><strong>{a.displayName}</strong><small className="cell-secondary">{a.accountId}</small></td><td><strong>{a.riskScore ?? '—'}</strong></td><td><RiskBadge risk={a.riskLevel}/></td><td><span className="signal-cell">{a.reasons[0] || '暂无异常信号'}</span></td><td><button className="icon-button" aria-label={'查看 ' + a.displayName} onClick={() => onAccount(accounts.find(b => b.id === a.id) || a)}><ChevronRight size={16}/></button></td></tr>)}</tbody></table></div> : <Empty title={task.status === 'queued' ? '任务已加入待执行队列' : '暂无识别结果'} text={task.status === 'queued' ? '点击下方“执行任务”，开始处理数据集。' : '任务成功完成后，识别结果将在这里展示。'}/>}<div className="modal-actions">{canEdit && ['queued', 'failed'].includes(task.status) && <div className="cancel-task-control">{confirmCancel ? <><span>确认取消此任务？</span><button className="text-link" disabled={busy} onClick={() => { onCancel(task); setConfirmCancel(false); }}>确认取消</button><button className="text-link" onClick={() => setConfirmCancel(false)}>返回</button></> : <button className="text-link" disabled={busy} onClick={() => setConfirmCancel(true)}>取消任务</button>}</div>}<button className="button" onClick={onClose}>关闭</button>{task.status === 'completed' && <button className="button" onClick={() => onExport(task)}><ArrowDownToLine size={16}/>导出 CSV</button>}{canEdit && ['queued', 'failed'].includes(task.status) && <button className="button button-primary" disabled={busy} onClick={() => onRun(task)}>{busy ? <Spinner text="正在执行"/> : <>{task.status === 'failed' ? <RefreshCw size={16}/> : <Play size={16}/>} {task.status === 'failed' ? '重试任务' : '执行任务'}</>}</button>}</div></Modal>;
}
interface ReviewRecord {
    id?: string;
    status: ReviewStatus;
    note: string;
    actor?: string;
    reviewerName?: string;
    createdAt: string;
}
export function AccountDetail({ account, data, onClose, onSaved }: {
    account: Account;
    data: Bootstrap;
    onClose: () => void;
    onSaved: (message: string) => Promise<void>;
}) {
    const [current, setCurrent] = useState(account);
    const [reviews, setReviews] = useState<ReviewRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [review, setReview] = useState<ReviewStatus>(account.reviewStatus === 'unreviewed' ? 'pending' : account.reviewStatus);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const canReview = ['admin', 'editor', 'reviewer'].includes(data.user.role);
    useEffect(() => { let active = true; api<{
        account: Account;
        reviews: ReviewRecord[];
    }>('/accounts/' + account.id).then(r => { if (active) {
        setCurrent(r.account);
        setReviews(r.reviews);
    } }).catch(e => { if (active)
        setError(e.message); }).finally(() => { if (active)
        setLoading(false); }); return () => { active = false; }; }, [account.id]);
    async function save(e: React.FormEvent) { e.preventDefault(); setError(''); setBusy(true); try {
        const result = await api<Account>('/accounts/' + account.id + '/review', { status: review, note });
        setCurrent(result);
        setNote('');
        const detail = await api<{
            account: Account;
            reviews: ReviewRecord[];
        }>('/accounts/' + account.id);
        setReviews(detail.reviews);
        await onSaved('人工复核已保存，并写入操作日志。');
    }
    catch (e) {
        setError(e instanceof Error ? e.message : '复核保存失败');
    }
    finally {
        setBusy(false);
    } }
    const textSamples = (current as Account & {
        textSamples?: string[];
    }).textSamples || [];
    const features = [{ label: '重复内容比例', value: Math.round(current.duplicateRatio * 100), text: Math.round(current.duplicateRatio * 100) + '%', color: 'amber' }, { label: '集中发帖比例', value: Math.round(current.burstRatio * 100), text: Math.round(current.burstRatio * 100) + '%', color: 'blue' }, { label: '夜间发帖比例', value: Math.round(current.nightRatio * 100), text: Math.round(current.nightRatio * 100) + '%', color: 'teal' }];
    return <Modal title="账号研判" subtitle="行为信号、识别解释与人工复核" drawer onClose={onClose}><div className="account-detail-header"><span className={'account-avatar avatar-' + current.riskLevel}>{current.displayName.charAt(0)}</span><div><h2>{current.displayName}</h2><p>{current.accountId} <b>·</b> {current.platform}</p></div>{current.demo && <Badge>合成样例</Badge>}</div><div className="risk-score-card"><div><span>行为风险评分</span><strong>{current.riskScore ?? '—'}<small>{current.riskScore !== null ? '/100' : ''}</small></strong></div><div><RiskBadge risk={current.riskLevel}/><span>{reviewNames[current.reviewStatus]}</span></div></div><section className="detail-section"><h3><ActivityIcon />账号行为特征</h3><div className="feature-stats"><div><strong>{fmt(current.postsCount)}</strong><span>发帖总量</span></div><div><strong>{fmt(current.accountAgeDays)}</strong><span>注册天数</span></div><div><strong>{fmt(current.followersCount)}</strong><span>粉丝数</span></div><div><strong>{fmt(current.followingCount)}</strong><span>关注数</span></div></div><div className="feature-bars">{features.map(f => <div key={f.label}><div><span>{f.label}</span><strong>{f.text}</strong></div><div className={'feature-bar ' + f.color}><i style={{ width: f.value + '%' }}/></div></div>)}</div><div className="key-value-row"><span>平均发帖间隔</span><strong>{fmt(current.avgIntervalSeconds)} 秒</strong></div></section><section className="detail-section"><h3><ListChecks size={17}/>识别解释</h3>{current.reasons.length ? <ul className="reason-list">{current.reasons.map((r, i) => <li key={i}><span>{String(i + 1).padStart(2, '0')}</span>{r}</li>)}</ul> : <p className="muted">尚无异常信号，或当前账号未完成识别。</p>}<p className="source-caption">所属数据集：{data.datasets.find(d => d.id === current.datasetId)?.name || current.datasetId}</p></section>{textSamples.length > 0 && <section className="detail-section"><h3><FileJson size={17}/>原始文本样例</h3><div className="text-samples">{textSamples.map((text, i) => <blockquote key={i}><span>样例 {i + 1}</span><p>{text}</p></blockquote>)}</div></section>}{current.relatedIds.length > 0 && <section className="detail-section"><h3><UsersIcon />关联账号</h3><div className="related-chips">{current.relatedIds.slice(0, 12).map(id => <span key={id}>{id}</span>)}{current.relatedIds.length > 12 && <span>另有 {current.relatedIds.length - 12} 个</span>}</div></section>}<section className="detail-section review-section"><h3><ShieldCheck size={17}/>人工复核</h3>{canReview ? <form onSubmit={save}><label className="field"><span>复核结论</span><select value={review} onChange={e => setReview(e.target.value as ReviewStatus)}><option value="pending">待进一步核实</option><option value="confirmed">确认异常行为</option><option value="dismissed">排除异常</option></select></label><label className="field"><span>复核说明 <em>*</em></span><textarea required minLength={3} maxLength={1000} rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="记录判断依据，便于其他成员回看。"/></label>{error && <div className="inline-error"><AlertCircle size={16}/>{error}</div>}<button className="button button-primary full" disabled={busy || note.trim().length < 3}>{busy ? <Spinner text="保存中"/> : <><CheckCheck size={16}/>保存复核结论</>}</button></form> : <div className="callout"><ShieldCheck size={17}/><p>当前为{roleNames[data.user.role]}，人工复核由管理员、开发成员或复核成员提交。</p></div>}</section><section className="detail-section"><h3><Clock3 size={17}/>复核记录</h3>{loading ? <Spinner /> : reviews.length ? <div className="review-history">{reviews.map((r, i) => <div key={r.id || i}><span className="history-dot"/><div><strong>{reviewNames[r.status] || r.status}</strong><p>{r.note}</p><small>{r.reviewerName || r.actor || '复核成员'} · {date(r.createdAt)}</small></div></div>)}</div> : <p className="muted small-text">暂无人工复核记录。</p>}</section></Modal>;
}
function ActivityIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>; }
function UsersIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M17 15a4 4 0 0 1 4 4v2"/></svg>; }
export function DatasetDetail({ dataset, accounts, onClose, onTask, onAccount, onOpenPage, canEdit }: {
    dataset: Dataset;
    accounts: Account[];
    onClose: () => void;
    onTask: () => void;
    onAccount: (a: Account) => void;
    onOpenPage: (page: 'screening' | 'leads') => void;
    canEdit: boolean;
}) {
    const [detail, setDetail] = useState<DatasetDetailPayload | null>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let alive = true;
        api<DatasetDetailPayload>('/datasets/' + dataset.id)
            .then(next => { if (alive) setDetail(next); })
            .catch(e => { if (alive) setError(e instanceof Error ? e.message : '数据集详情加载失败'); });
        return () => { alive = false; };
    }, [dataset.id]);

    const kindNames: Record<string, string> = { accounts: '账号型', douyin: '评论型', coordination: '线索型' };
    const overview = detail?.overview;
    const rows = detail?.accounts?.length ? detail.accounts : accounts.filter(a => a.datasetId === dataset.id).slice(0, 8);

    return <Modal title={dataset.name} subtitle={`数据集详情 · ${kindNames[detail?.dataset.kind || dataset.kind] || '账号型'}`} wide onClose={onClose}>
        <div className="detail-status"><Badge kind="teal" dot>已就绪</Badge><Badge>{dataset.version}</Badge><Badge>{dataset.format.toUpperCase()}</Badge>{dataset.demo && <Badge>合成样例</Badge>}</div>
        <div className="dataset-detail-meta">
            <div><span>{overview?.label || '账号记录'}</span><strong>{fmt(overview?.primary ?? dataset.recordCount)}</strong></div>
            <div><span>数据来源</span><strong>{dataset.source}</strong></div>
            <div><span>导入时间</span><strong>{date(dataset.createdAt)}</strong></div>
        </div>
        {overview && <div className="inline-stats">{overview.items.map(item => <span key={item.label}>{item.label} <strong>{item.value}</strong></span>)}</div>}
        <p className="muted">{overview?.note || dataset.description || '数据通过标准字段校验后已入库。'}</p>
        {error && <div className="inline-error"><AlertCircle size={16}/>{error}</div>}
        {!detail && !error && <div className="loading-block"><Spinner text="正在读取数据集"/></div>}

        {detail?.dataset.kind === 'douyin' && <>
            <h3 className="detail-subtitle">评论预览 <span>前 {detail.comments.length} 条</span></h3>
            <div className="table-scroll"><table className="data-table"><thead><tr><th>时间(北京)</th><th>昵称</th><th>评论原文</th><th>IP属地</th><th>时间精度</th></tr></thead>
                <tbody>{detail.comments.map(c => <tr key={c.id}>
                    <td>{c.publishTimeIso ? new Date(c.publishTimeIso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }).slice(0, 16) : '—'}</td>
                    <td>{c.authorName || '—'}<small className="cell-secondary mono">{c.sourceAccountKey.slice(0, 14)}…</small></td>
                    <td>{c.content}</td>
                    <td>{c.ipRegion || '—'}</td>
                    <td>{c.timePrecision === 'approximate' ? '近似' : c.timePrecision}</td>
                </tr>)}</tbody></table></div>
        </>}

        {detail?.dataset.kind === 'coordination' && <>
            <h3 className="detail-subtitle">线索预览 <span>按账号数排序,前 {detail.leads.length} 组</span></h3>
            <div className="table-scroll"><table className="data-table"><thead><tr><th>线索</th><th>来源事件</th><th>账号数</th><th>评论数</th><th>最小相似度</th><th>复核状态</th></tr></thead>
                <tbody>{detail.leads.map(l => <tr key={l.id}>
                    <td><strong>{l.representative.slice(0, 20)}</strong><small className="cell-secondary mono">{l.id}</small></td>
                    <td className="mono">{l.eventRef}</td>
                    <td>{l.accountCount}</td>
                    <td>{l.commentCount}</td>
                    <td>{l.minSimilarity?.toFixed(4) ?? '—'}</td>
                    <td><Badge kind={l.reviewStatus === 'confirmed' ? 'red' : l.reviewStatus === 'dismissed' ? 'teal' : 'amber'}>{l.reviewStatus === 'confirmed' ? '确认线索' : l.reviewStatus === 'dismissed' ? '排除线索' : l.reviewStatus === 'following' ? '保留观察' : '待复核'}</Badge></td>
                </tr>)}</tbody></table></div>
        </>}

        {(detail?.dataset.kind === 'accounts' || !detail) && <>
            <h3 className="detail-subtitle">账号预览 <span>前 {Math.min(rows.length, 8)} 条</span></h3>
            <div className="table-scroll"><table className="data-table"><thead><tr><th>账号</th><th>平台</th><th>发帖数</th><th>注册天数</th><th>风险等级</th><th /></tr></thead>
                <tbody>{rows.slice(0, 8).map(a => <tr key={a.id}><td><strong>{a.displayName}</strong><small className="cell-secondary">{a.accountId}</small></td><td>{a.platform}</td><td>{a.postsCount}</td><td>{a.accountAgeDays}</td><td><RiskBadge risk={a.riskLevel}/></td><td><button aria-label={'查看 ' + a.displayName} className="icon-button" onClick={() => onAccount(a)}><ChevronRight size={16}/></button></td></tr>)}</tbody></table></div>
            {!rows.length && <Empty title="这个数据集没有账号记录" text="账号型数据集才提供账号预览与摸排任务。"/>}
        </>}

        <div className="modal-actions">
            <button className="button" onClick={onClose}>关闭</button>
            {detail?.dataset.kind === 'douyin' && <button className="button button-primary" onClick={() => onOpenPage('screening')}><ArrowRight size={16}/>去评论检测</button>}
            {detail?.dataset.kind === 'coordination' && <button className="button button-primary" onClick={() => onOpenPage('leads')}><ArrowRight size={16}/>去协同线索</button>}
            {canEdit && detail?.dataset.kind !== 'douyin' && detail?.dataset.kind !== 'coordination' && <button className="button button-primary" onClick={onTask}><Plus size={16}/>基于此数据集新建任务</button>}
        </div>
    </Modal>;
}

export function MemberModal({ onClose, onSuccess }: {
    onClose: () => void;
    onSuccess: (message: string) => Promise<void>;
}) { const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [role, setRole] = useState<Role>('editor'); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); async function submit(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(''); try {
    await api<Member>('/members', { name: name.trim(), email: email.trim(), role });
    await onSuccess('成员权限已保存。请同时在 Sites 访问设置中授权该成员。');
    onClose();
}
catch (e) {
    setError(e instanceof Error ? e.message : '添加失败');
}
finally {
    setBusy(false);
} } return <Modal title="添加协作成员" subtitle="使用成员登录时的邮箱绑定应用角色。" onClose={onClose}><form onSubmit={submit}><label className="field"><span>成员姓名 <em>*</em></span><input required value={name} onChange={e => setName(e.target.value)} placeholder="输入成员姓名" maxLength={60}/></label><label className="field"><span>登录邮箱 <em>*</em></span><input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com"/></label><label className="field"><span>应用角色</span><select value={role} onChange={e => setRole(e.target.value as Role)}>{Object.entries(roleNames).filter(([key]) => key !== 'admin').map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label><div className="callout"><Info size={18}/><p>这里配置应用内操作权限。网站访问权限需在 Sites 共享设置中授权；GitHub 代码推送权限在仓库中配置。</p></div>{error && <div className="inline-error"><AlertCircle size={16}/>{error}</div>}<div className="modal-actions"><button type="button" className="button" onClick={onClose}>取消</button><button className="button button-primary" disabled={busy}>{busy ? <Spinner text="保存中"/> : <><UserPlus size={16}/>保存成员</>}</button></div></form></Modal>; }

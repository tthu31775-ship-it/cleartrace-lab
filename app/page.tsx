'use client';
import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowRight, Bell, BookOpen, ChevronRight, CircleHelp, Code2, Database, FileClock, FolderGit2, LayoutDashboard, ListChecks, LogOut, Menu, Network, Plus, RefreshCw, Search, ShieldCheck, Upload, Users, Waves, X } from 'lucide-react';
import type { Account, Bootstrap, Dataset, Task } from '@/lib/contracts';
import { api, Badge, downloadCsv, roleNames, Spinner, Toast } from '@/components/cleartrace/common';
import { LoginScreen } from '@/components/cleartrace/login';
import { Accounts, Datasets, Graph, Integrations, Logs, Overview, Page, PanelProps, Tasks, Team } from '@/components/cleartrace/panels';
import { AccountDetail, DatasetDetail, ImportModal, MemberModal, NewTaskModal, TaskDetail } from '@/components/cleartrace/forms';
const navigation = [{ id: 'overview', name: '总览工作台', icon: LayoutDashboard }, { id: 'tasks', name: '摸排任务', icon: ListChecks }, { id: 'datasets', name: '数据集', icon: Database }, { id: 'accounts', name: '账号研判', icon: ShieldCheck }, { id: 'graph', name: '传播图谱', icon: Network }, { id: 'integrations', name: '数据与模型接口', icon: Code2 }, { id: 'logs', name: '操作日志', icon: FileClock }, { id: 'team', name: '项目协作', icon: FolderGit2 }] as const;
const pageInfo: Record<Page, {
    eyebrow: string;
    description: string;
}> = { overview: { eyebrow: 'WORKSPACE OVERVIEW', description: '从数据导入到结果复核，一处掌握研判进度。' }, tasks: { eyebrow: 'INVESTIGATION TASKS', description: '提交识别任务，跟踪执行进度，保留每一次结果。' }, datasets: { eyebrow: 'DATA COLLECTIONS', description: '让每一份数据交付，都有清晰的格式和版本。' }, accounts: { eyebrow: 'ACCOUNT REVIEW', description: '结合行为信号与识别解释，形成可追溯的人工判断。' }, graph: { eyebrow: 'RELATIONSHIP EXPLORER', description: '展开账号关联，在关系中查看协同行为线索。' }, integrations: { eyebrow: 'INTEGRATION HUB', description: '统一数据与模型协议，让团队模块顺畅接入。' }, logs: { eyebrow: 'ACTIVITY & AUDIT', description: '记录关键操作、执行结果与失败原因。' }, team: { eyebrow: 'PROJECT COLLABORATION', description: '分工明确、接口稳定，共同推进项目交付。' } };
export default function Home() {
    const [data, setData] = useState<Bootstrap | null>(null);
    const [error, setError] = useState('');
    const [authRequired, setAuthRequired] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [page, setPage] = useState<Page>('overview');
    const [mobileOpen, setMobileOpen] = useState(false);
    const [globalSearch, setGlobalSearch] = useState('');
    const [initialSearch, setInitialSearch] = useState('');
    const [modal, setModal] = useState<'import' | 'task' | 'member' | null>(null);
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
    const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
    const [defaultDataset, setDefaultDataset] = useState<string | undefined>();
    const [busyTask, setBusyTask] = useState<string | null>(null);
    const [toast, setToast] = useState<{
        text: string;
        type: 'success' | 'error';
    } | null>(null);
    const notify = useCallback((text: string, type: 'success' | 'error' = 'success') => setToast({ text, type }), []);
    const closeToast = useCallback(() => setToast(null), []);
    const load = useCallback(async () => { setRefreshing(true); try {
        const next = await api<Bootstrap>('/bootstrap');
        setData(next);
        setError('');
        setSelectedTask(old => old ? next.tasks.find(t => t.id === old.id) || old : null);
        return next;
    }
    catch (e) {
        if ((e as { status?: number }).status === 401) {
            setAuthRequired(true);
            setError('');
            return null;
        }
        setError(e instanceof Error ? e.message : '无法加载工作空间');
        return null;
    }
    finally {
        setRefreshing(false);
    } }, []);
    useEffect(() => { load(); const read = () => { const hash = window.location.hash.slice(1).split('?')[0]; if (navigation.some(n => n.id === hash))
        setPage(hash as Page);
    else
        setPage('overview'); }; read(); window.addEventListener('hashchange', read); return () => window.removeEventListener('hashchange', read); }, [load]);
    function go(next: Page) { setPage(next); setMobileOpen(false); setInitialSearch(''); window.location.hash = next; window.scrollTo({ top: 0, behavior: 'smooth' }); }
    function search(e: React.FormEvent) { e.preventDefault(); if (!globalSearch.trim())
        return; setInitialSearch(globalSearch.trim()); setPage('accounts'); window.location.hash = 'accounts'; setGlobalSearch(''); setMobileOpen(false); }
    async function onSaved(message: string) { await load(); notify(message); }
    async function runTask(task: Task) { setBusyTask(task.id); try {
        const next = await api<Task>('/tasks/' + task.id + '/run', {});
        setSelectedTask(next);
        await load();
        notify(`任务已完成：处理 ${next.processed} 个账号，发现 ${next.suspectedCount} 个候选异常。`);
    }
    catch (e) {
        await load();
        notify(e instanceof Error ? e.message : '任务执行失败', 'error');
    }
    finally {
        setBusyTask(null);
    } }
    async function cancelTask(task: Task) { setBusyTask(task.id); try {
        const updated = await api<Task>('/tasks/' + task.id + '/cancel', {});
        setSelectedTask(updated);
        await load();
        notify('任务已取消，原始记录仍然保留。');
    }
    catch (e) {
        notify(e instanceof Error ? e.message : '取消失败', 'error');
    }
    finally {
        setBusyTask(null);
    } }
    async function onCreated(task: Task, run: boolean) { await load(); setSelectedTask(task); if (run)
        await runTask(task);
    else
        notify('任务已创建并加入待执行队列。'); }
    async function exportTask(task: Task) { try {
        await downloadCsv('/tasks/' + task.id + '/export', '清源-' + task.name + '-结果.csv');
        notify('识别结果已导出。');
    }
    catch (e) {
        notify(e instanceof Error ? e.message : '导出失败', 'error');
    } }
    async function onLogin() { setAuthRequired(false); await load(); }
    async function signOut() { try {
        await api<{ signedOut: boolean }>('/auth/logout', {});
    }
    catch { /* 即使会话已失效也回到登录页 */ } setData(null); setAuthRequired(true); }
    function openAccount(account: Account) { setSelectedTask(null); setSelectedDataset(null); setSelectedAccount(account); }
    const canEdit = data ? ['admin', 'editor'].includes(data.user.role) : false;
    const panelProps: PanelProps | undefined = data ? { data, go, newTask: () => { setDefaultDataset(undefined); setModal('task'); }, importData: () => setModal('import'), openTask: setSelectedTask, openAccount, openDataset: setSelectedDataset, runTask, exportTask, newMember: () => setModal('member'), notify, refresh: load, canEdit, busyTask, initialSearch } : undefined;
    const currentNav = navigation.find(n => n.id === page)!;
    return <div className="app-shell">{mobileOpen && <button className="sidebar-overlay" aria-label="关闭导航" onClick={() => setMobileOpen(false)}/>}<aside className={'sidebar' + (mobileOpen ? ' sidebar-open' : '')}><a href="#overview" className="brand" onClick={() => go('overview')}><span className="brand-symbol"><Waves size={26}/></span><span><strong>清源</strong><small>CLEARTRACE</small></span></a><div className="workspace-selector"><span className="workspace-initial">研</span><div><strong>研究工作空间</strong><span>网络水军摸排系统</span></div><span className="workspace-dot"/></div><div className="nav-group-label">工作台</div><nav aria-label="主导航">{navigation.slice(0, 5).map(item => <button key={item.id} className={'nav-item' + (page === item.id ? ' selected' : '')} onClick={() => go(item.id)} aria-current={page === item.id ? 'page' : undefined}><item.icon size={18}/><span>{item.name}</span>{item.id === 'accounts' && !!data?.stats.pendingReviews && <small>{data.stats.pendingReviews}</small>}</button>)}</nav><div className="nav-group-label second">协作与管理</div><nav aria-label="协作与管理">{navigation.slice(5).map(item => <button key={item.id} className={'nav-item' + (page === item.id ? ' selected' : '')} onClick={() => go(item.id)} aria-current={page === item.id ? 'page' : undefined}><item.icon size={18}/><span>{item.name}</span></button>)}</nav><div className="sidebar-bottom"><button className="sidebar-help" onClick={() => go('integrations')}><CircleHelp size={17}/>接入与使用帮助<ChevronRight size={14}/></button><div className="system-status"><div><i className={error ? 'status-warning' : ''}/><strong>{error ? '连接待恢复' : data ? '服务连接正常' : '连接工作空间'}</strong></div><span>{data?.workspace.version || 'v1.0'} <b>·</b> 协作开发版</span></div><div className="sidebar-footer">CLEARER SIGNALS. BETTER DECISIONS.</div></div></aside><div className="main-shell"><header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="打开导航" onClick={() => setMobileOpen(true)}><Menu size={20}/></button><span>工作空间</span><ChevronRight size={13}/><strong>{currentNav.name}</strong></div><div className="topbar-actions"><form className="top-search" onSubmit={search}><Search size={15}/><input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} placeholder="搜索账号 ID 或昵称" aria-label="全局账号搜索"/><kbd>↵</kbd></form><button className="icon-button" title="刷新数据" aria-label="刷新数据" onClick={() => load()} disabled={refreshing}><RefreshCw size={17} className={refreshing ? 'spin' : ''}/></button><button className="icon-button notification-button" title="查看操作日志" aria-label="查看操作日志" onClick={() => go('logs')}><Bell size={18}/></button><span className="topbar-divider"/><button className="profile-button" onClick={() => go('team')} aria-label="查看成员与权限"><span className="profile-avatar">{data?.user.name?.charAt(0) || '赵'}</span><span><strong>{data?.user.name || '项目工作台'}</strong><small>{data ? roleNames[data.user.role] : '正在连接'}</small></span></button><button className="icon-button" title="退出登录" aria-label="退出登录" onClick={signOut}><LogOut size={17}/></button></div></header><main className="main-content"><div className="page-heading"><div><div className="eyebrow">{pageInfo[page].eyebrow}</div><h1>{currentNav.name}<span className="page-title-dot"/></h1><p>{pageInfo[page].description}</p></div><div className="page-actions">{['overview', 'datasets'].includes(page) && <button className="button" onClick={() => setModal('import')} disabled={!canEdit}><Upload size={16}/>导入数据</button>}{['overview', 'tasks', 'datasets'].includes(page) && <button className="button button-primary" onClick={() => { setDefaultDataset(undefined); setModal('task'); }} disabled={!canEdit}><Plus size={17}/>新建摸排任务</button>}{page === 'integrations' && <a className="button" href="/api/v1/openapi" target="_blank" rel="noreferrer"><BookOpen size={16}/>完整接口文档</a>}{page === 'team' && <a className="button button-primary" href="https://github.com/tthu31775-ship-it/cleartrace-lab" target="_blank" rel="noreferrer"><Code2 size={17}/>打开 GitHub</a>}</div></div>{authRequired ? <LoginScreen onSignedIn={onLogin}/> : error && !data ? <div className="card connection-error"><div className="empty-icon"><ShieldCheck size={28}/></div><h2>暂时无法打开工作空间</h2><p>{error}</p><div><button className="button" onClick={() => load()}><RefreshCw size={16}/>重新连接</button><button className="button button-primary" onClick={() => setAuthRequired(true)}><ArrowRight size={16}/>重新登录</button></div><small>已登录但无法访问？请由项目管理员检查工作空间成员权限。</small></div> : !data ? <div className="loading-workspace"><div className="loading-logo"><Waves size={32}/></div><Spinner text="正在加载工作空间"/><p>读取数据集、摸排任务与复核结果</p><div className="skeleton-grid">{[0, 1, 2, 3].map(i => <div key={i}/>)}</div></div> : panelProps && <div className="page-body" key={page + (page === 'accounts' ? initialSearch : '')}>{error && <div className="stale-notice">最新数据未能刷新，当前保留上一次成功加载的内容。<button onClick={() => load()}>重试</button></div>}{page === 'overview' ? <Overview {...panelProps}/> : page === 'tasks' ? <Tasks {...panelProps}/> : page === 'datasets' ? <Datasets {...panelProps}/> : page === 'accounts' ? <Accounts {...panelProps}/> : page === 'graph' ? <Graph {...panelProps}/> : page === 'integrations' ? <Integrations {...panelProps}/> : page === 'logs' ? <Logs {...panelProps}/> : <Team {...panelProps}/>}</div>}<footer className="content-footer"><span>清源 ClearTrace <b>·</b> 数据、识别与复核协作平台</span><a href="https://github.com/tthu31775-ship-it/cleartrace-lab" target="_blank" rel="noreferrer">项目源码<ArrowUpRightIcon /></a></footer></main></div>{modal === 'import' && <ImportModal onClose={() => setModal(null)} onSuccess={onSaved}/>} {modal === 'task' && data && <NewTaskModal data={data} defaultDataset={defaultDataset} onClose={() => setModal(null)} onCreated={onCreated}/>} {modal === 'member' && <MemberModal onClose={() => setModal(null)} onSuccess={onSaved}/>} {selectedTask && data && <TaskDetail task={selectedTask} accounts={data.accounts} onClose={() => setSelectedTask(null)} onAccount={openAccount} onRun={runTask} onExport={exportTask} onCancel={cancelTask} busy={busyTask === selectedTask.id} canEdit={canEdit}/>} {selectedAccount && data && <AccountDetail account={selectedAccount} data={data} onClose={() => setSelectedAccount(null)} onSaved={onSaved}/>} {selectedDataset && data && <DatasetDetail dataset={selectedDataset} accounts={data.accounts} canEdit={canEdit} onClose={() => setSelectedDataset(null)} onAccount={openAccount} onTask={() => { setDefaultDataset(selectedDataset.id); setSelectedDataset(null); setModal('task'); }}/>} {toast && <Toast text={toast.text} type={toast.type} onClose={closeToast}/>}</div>;
}
function ArrowUpRightIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17 17 7M7 7h10v10"/></svg>; }

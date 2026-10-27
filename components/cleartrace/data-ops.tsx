'use client';
// 事件协同扫描 + 数据导出中心。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Database, Download, FileJson, Play, RefreshCw, ShieldAlert } from 'lucide-react';
import type { ExportSummary, ScanResult } from '@/lib/contracts';
import { api, Badge, downloadCsv, Empty, SectionTitle, Spinner } from './common';
import type { PanelProps } from './panels';

const SAMPLE = JSON.stringify([
    { accountId: 'u_1001', text: '这事必须严查，转发让更多人看到！', publishTime: 1720091220 },
    { accountId: 'u_1002', text: '这事必须严查,转发让更多人看到!', publishTime: 1720091260 },
    { accountId: 'u_1003', text: '这事必须严查，转发让更多人看到！', publishTime: 1720091310 },
    { accountId: 'u_1004', text: '这事必须严查，转发让更多人看到！', publishTime: 1720091380 },
    { accountId: 'u_1005', text: '这事必须严查，转发让更多人看到！', publishTime: 1720091450 },
    { accountId: 'u_2001', text: '这个视频拍得真不错，构图很舒服', publishTime: 1720091500 },
], null, 2);

const bj = (unix: number | null | undefined) => unix === null || unix === undefined
    ? '—'
    : new Date((unix + 8 * 3600) * 1000).toISOString().replace('T', ' ').slice(5, 16);

export function Scan(p: PanelProps) {
    const [eventId, setEventId] = useState('demo-event-001');
    const [raw, setRaw] = useState(SAMPLE);
    const [minAccounts, setMinAccounts] = useState(5);
    const [windowMinutes, setWindowMinutes] = useState(10);
    const [threshold, setThreshold] = useState(0.82);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState<ScanResult | null>(null);

    function parseComments(text: string) {
        const trimmed = text.trim();
        if (!trimmed)
            return [];
        if (trimmed.startsWith('[')) {
            const parsed = JSON.parse(trimmed) as unknown;
            if (!Array.isArray(parsed))
                throw new Error('JSON 必须是数组');
            return parsed;
        }
        // 兜底:每行「账号键<TAB>Unix时间<TAB>评论原文」
        return trimmed.split(/\r?\n/).map((line, index) => {
            const [accountId, stamp, ...rest] = line.split('\t');
            if (!accountId || !stamp || !rest.length)
                throw new Error(`第 ${index + 1} 行格式应为:账号键<TAB>Unix时间<TAB>评论原文`);
            return { accountId: accountId.trim(), publishTime: Number(stamp.trim()), text: rest.join('\t') };
        });
    }

    async function run() {
        setBusy(true);
        setError('');
        try {
            const comments = parseComments(raw);
            if (!comments.length)
                throw new Error('请先填入评论数据');
            const res = await api<ScanResult>('/coordination/scan', { eventId, comments, parameters: { minAccounts, windowMinutes, similarityThreshold: threshold } });
            setResult(res);
            if (!res.persisted)
                p.notify(res.note, 'error');
            else
                p.notify(`扫描完成:保留 ${res.retainedCommentCount} 条,发现 ${res.leadCount} 组候选线索,已入库。`);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : '扫描失败');
        }
        finally {
            setBusy(false);
        }
    }

    return <>
        <div className="notice-mark"><ShieldAlert size={17}/><span>在线扫描用<strong>在线清洗口径</strong>(10 条通用短句)运行,与交付的离线 803 条<strong>不是同一次运行</strong>,不能互相覆盖;结果里的排序分是启发式加权分,不是身份概率。</span></div>
        <div className="dashboard-bottom" style={{ alignItems: 'start' }}>
            <section className="card">
                <SectionTitle title="评论输入" subtitle="支持接口包里的 JSON 结构,或每行「账号键<TAB>Unix秒<TAB>原文」;单次 1-5000 条。" action={<button className="button button-soft" onClick={() => setRaw(SAMPLE)}>填入示例</button>}/>
                <label className="field"><span>事件标识(必填,用于追溯)</span><input value={eventId} onChange={e => setEventId(e.target.value)} placeholder="例如 news-20261027-001"/></label>
                <label className="field"><span>评论数据</span><textarea rows={12} value={raw} onChange={e => setRaw(e.target.value)} spellCheck={false}/></label>
            </section>
            <section className="card">
                <SectionTitle title="参数" subtitle="参数会随运行一起入库,便于复算。" />
                <div className="field-grid">
                    <label className="field"><span>最少不同账号数</span><input type="number" min={2} max={100} value={minAccounts} onChange={e => setMinAccounts(Number(e.target.value))}/></label>
                    <label className="field"><span>时间窗(分钟)</span><input type="number" min={1} max={60} value={windowMinutes} onChange={e => setWindowMinutes(Number(e.target.value))}/></label>
                    <label className="field"><span>相似度阈值</span><input type="number" min={0.5} max={1} step={0.01} value={threshold} onChange={e => setThreshold(Number(e.target.value))}/></label>
                </div>
                <div className="inline-stats"><span>口径 <strong>字符 2/3-gram Jaccard</strong></span><span>阈值 <strong>{threshold}</strong></span></div>
                <button className="button button-primary" style={{ width: '100%', marginTop: '14px' }} disabled={busy} onClick={run}>{busy ? <><RefreshCw size={15} className="spin"/>扫描中</> : <><Play size={15}/>开始扫描并入库</>}</button>
                <p className="source-caption">扫描结果会在「协同线索」里以新批次出现,可复核、可导出。</p>
            </section>
        </div>
        {error && <div className="inline-error"><AlertCircle size={16}/>{error}</div>}
        {result && <section className="card">
            <SectionTitle title="本次扫描结果" subtitle={`运行 ${result.runId} · 模型 ${result.modelVersion} · 清洗 ${result.preprocessingVersion}`} action={<Badge kind={result.leadCount ? 'amber' : 'teal'} dot>{result.leadCount} 组候选</Badge>}/>
            <div className="inline-stats">
                <span>提交 <strong>{result.inputCommentCount}</strong></span>
                <span>保留 <strong>{result.retainedCommentCount}</strong></span>
                <span>候选线索 <strong>{result.leadCount}</strong></span>
                <span>涉及账号 <strong>{result.accounts}</strong></span>
                <span>入库 <strong>{result.persisted ? '是' : '否'}</strong></span>
            </div>
            {!!Object.keys(result.skipped).length && <p className="source-caption">清洗跳过:{Object.entries(result.skipped).map(([k, v]) => `${k}=${v}`).join(' · ')}</p>}
            {!result.leads.length && <Empty title="没有达到阈值的候选组" text="可以降低最少账号数、放宽时间窗或下调相似度阈值后再试。"/>}
            {!!result.leads.length && <div className="table-scroll"><table className="data-table"><thead><tr><th>线索</th><th>代表评论</th><th>账号 / 评论</th><th>时间窗(北京)</th><th>最小相似度</th><th>排序分</th><th className="align-right">操作</th></tr></thead>
                <tbody>{result.leads.map(lead => <tr key={lead.id}>
                    <td className="mono">{lead.id}</td>
                    <td>{lead.representative.slice(0, 30)}</td>
                    <td><strong>{lead.accountCount}</strong> / {lead.commentCount}</td>
                    <td>{bj(lead.startTime)} — {bj(lead.endTime)}</td>
                    <td>{lead.minSimilarity.toFixed(4)}</td>
                    <td><div className="score-value"><strong>{lead.probability.toFixed(4)}</strong><span>启发式</span></div></td>
                    <td className="align-right"><button className="text-link" onClick={() => p.go('leads')}>去复核</button></td>
                </tr>)}</tbody></table></div>}
            <p className="source-caption">{result.note}</p>
        </section>}
        {result && !!result.leads.length && <section className="card">
            <SectionTitle title="账号维度排序分" subtitle="0.70×平均文本相似度 + 0.20×参与度 + 0.10×时间集中度,未校准。"/>
            <div className="table-scroll"><table className="data-table"><thead><tr><th>来源账号键</th><th>评论数</th><th>平均相似度</th><th>排序分</th><th>证据评论</th></tr></thead>
                <tbody>{result.leads[0].accounts.map(account => <tr key={account.accountId}>
                    <td className="mono">{account.accountId}</td><td>{account.commentCount}</td>
                    <td>{account.meanSimilarity.toFixed(4)}</td>
                    <td>{account.suspectedWaterArmyProbability.toFixed(4)}</td>
                    <td className="small-text">{account.evidenceComments[0]?.slice(0, 40)}</td>
                </tr>)}</tbody></table></div>
        </section>}
    </>;
}

export function Exports(p: PanelProps) {
    const [summary, setSummary] = useState<ExportSummary | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');

    const load = useCallback(async () => {
        try {
            setSummary(await api<ExportSummary>('/exports/summary'));
            setError('');
        }
        catch (e) {
            setError(e instanceof Error ? e.message : '导出清单加载失败');
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    const totalRows = useMemo(() => (summary?.tables ?? []).reduce((sum, table) => sum + table.rows, 0), [summary]);

    async function download(path: string, name: string) {
        setBusy(path);
        try {
            await downloadCsv(path, name);
            p.notify('已开始下载。');
        }
        catch (e) {
            p.notify(e instanceof Error ? e.message : '下载失败', 'error');
        }
        finally {
            setBusy('');
        }
    }

    if (error)
        return <div className="inline-error"><AlertCircle size={16}/>{error}</div>;
    if (!summary)
        return <div className="loading-block"><Spinner text="正在统计可导出数据"/></div>;

    return <>
        <div className="notice-mark"><Database size={17}/><span>所有导出都要求登录;线索、评论、账号键属于敏感数据,每次下载都会写进操作日志。CSV 带 BOM,Excel 直接打开不乱码。</span></div>
        <div className="metric-grid">
            <div className="metric-card"><div className="metric-top"><span className="metric-icon metric-icon-1"><Database size={17}/></span><span className="tiny-label">可导出对象</span></div><strong>{summary.tables.length}</strong><span className="metric-caption">张业务表</span></div>
            <div className="metric-card"><div className="metric-top"><span className="metric-icon metric-icon-2"><FileJson size={17}/></span><span className="tiny-label">总行数</span></div><strong>{totalRows.toLocaleString('zh-CN')}</strong><span className="metric-caption">含线索、评论、结果、边与日志</span></div>
            <div className="metric-card"><div className="metric-top"><span className="metric-icon metric-icon-3"><Download size={17}/></span><span className="tiny-label">数据库体积</span></div><strong>{Math.max(1, Math.round(summary.databaseBytes / 1024 / 1024))} MB</strong><span className="metric-caption">含索引与图谱 JSON</span></div>
        </div>
        <section className="card">
            <SectionTitle title="逐表下载" subtitle="CSV 用中文表头便于查阅;JSON 保留原始字段名,便于二次处理。" action={<button className="button button-soft" onClick={load}><RefreshCw size={15}/>刷新统计</button>}/>
            <div className="table-scroll"><table className="data-table"><thead><tr><th>对象</th><th>说明</th><th>行数</th><th>敏感</th><th className="align-right">下载</th></tr></thead>
                <tbody>{summary.tables.map(table => <tr key={table.key}>
                    <td><strong>{table.label}</strong><small className="cell-secondary mono">{table.key}</small></td>
                    <td className="small-text">{table.description}</td>
                    <td>{table.rows.toLocaleString('zh-CN')}</td>
                    <td>{table.sensitive ? <Badge kind="amber">含敏感字段</Badge> : <Badge kind="neutral">一般</Badge>}</td>
                    <td className="align-right">
                        <div className="filter-group" style={{ justifyContent: 'flex-end' }}>
                            <button className="button button-soft" disabled={busy === `/exports/${table.key}?format=csv`} onClick={() => download(`/exports/${table.key}?format=csv`, `清源-${table.label}.csv`)}>CSV</button>
                            <button className="button button-soft" disabled={busy === `/exports/${table.key}?format=json`} onClick={() => download(`/exports/${table.key}?format=json`, `清源-${table.label}.json`)}>JSON</button>
                        </div>
                    </td>
                </tr>)}</tbody></table></div>
        </section>
        <div className="dashboard-bottom" style={{ alignItems: 'start' }}>
            <section className="card">
                <SectionTitle title="整库备份" subtitle="全部业务表打成一个 JSON,便于离线对账或迁移。"/>
                <div className="filter-group">
                    <button className="button button-primary" disabled={busy === '/exports/backup'} onClick={() => download('/exports/backup', `清源-全库备份-${new Date().toISOString().slice(0, 10)}.json`)}><Download size={15}/>下载全库备份</button>
                    <button className="button button-soft" disabled={busy === '/exports/schema'} onClick={() => download('/exports/schema', 'cleartrace-schema.sql')}><FileJson size={15}/>下载建表语句</button>
                </div>
                <p className="source-caption">全库备份只对管理员开放;需要文件级备份时,在服务器上直接拷贝 <code>.wrangler/state/v3/d1</code> 下的 sqlite。</p>
            </section>
            <section className="card">
                <SectionTitle title="导出说明" subtitle="口径与边界。"/>
                <ul className="reason-list">{summary.notes.map((note, index) => <li key={index}><ShieldAlert size={15}/>{note}</li>)}</ul>
                <p className="source-caption">生成时间 {new Date(summary.generatedAt).toLocaleString('zh-CN', { hour12: false })}</p>
            </section>
        </div>
        <section className="card">
            <SectionTitle title="脚本化下载" subtitle="用接口令牌直接拉数据,便于定期备份。"/>
            <pre className="code-block">{`# 1) 在「接口与协议」里创建一个只读/编辑令牌(ct_ 开头)
# 2) 直接下载,不需要浏览器登录
curl -H "Authorization: Bearer ct_xxx" \\\\
  "${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/exports/leads?format=csv" -o leads.csv

curl -H "Authorization: Bearer ct_xxx" \\\\
  "${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/exports/backup" -o backup.json`}</pre>
        </section>
    </>;
}

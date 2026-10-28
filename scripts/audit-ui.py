# -*- coding: utf-8 -*-
"""逐个点击工作台里所有可交互元素，判断"有没有用"。

判定标准（任一成立即算有反应）：
  1. URL hash 变化（切页）  2. 弹出模态/抽屉  3. 出现 toast  4. 发出新的 API 请求
  5. 触发下载              6. DOM 文本发生明显变化  7. 图谱变换  8. 新开页面
无反应的按钮会被列出来，用于修掉"只能看前端"的死按钮。

用法：
    python -u scripts/audit-ui.py http://127.0.0.1:3100 [输出json]
    python -u scripts/audit-ui.py http://127.0.0.1:3000 out.json --pages leads,scan
    python -u scripts/audit-ui.py http://127.0.0.1:3100 out.json --max-elements 3

为什么要 -u：脚本每点一个元素都会打印进度，不加 -u 时 Python 会攒着不输出，
看起来就像"卡死"（上一轮就因此被误判成 hang，其实是 185 个元素 × 每元素一次页面重载）。
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
import time
import traceback

from playwright.sync_api import sync_playwright

PAGES = [
    ('overview', '总览工作台'),
    ('leads', '协同线索'),
    ('screening', '评论检测'),
    ('scan', '事件扫描'),
    ('tasks', '摸排任务'),
    ('datasets', '数据集'),
    ('accounts', '账号研判'),
    ('graph', '传播图谱'),
    ('exports', '数据导出'),
    ('models', '模型接入'),
    ('integrations', '接口与协议'),
    ('logs', '操作日志'),
    ('team', '项目协作'),
]

SELECTOR = '.page-body button:visible, .page-body a.text-link:visible, .page-body .text-link:visible'
SKIP_NAMES = {'登录工作空间'}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('base', nargs='?', default='http://127.0.0.1:3100')
    parser.add_argument('out', nargs='?', default='')
    parser.add_argument('--pages', default='', help='只跑这些页，逗号分隔，如 leads,scan')
    parser.add_argument('--max-elements', type=int, default=0, help='每页最多测几个元素（调试用）')
    parser.add_argument('--email', default=os.environ.get('CT_EMAIL', 'admin@cleartrace.local'))
    parser.add_argument('--password', default=os.environ.get('CT_PASSWORD', 'ClearTrace2026'))
    parser.add_argument('--settle-ms', type=int, default=500, help='点击后等待毫秒数')
    return parser.parse_args()


ARGS = parse_args()
BASE = ARGS.base.rstrip('/')
OUT = pathlib.Path(ARGS.out or '/tmp/ui-audit.json')


def log(message: str) -> None:
    print(message, flush=True)


def body_signature(page) -> str:
    """页面内容指纹。

    以前用 Playwright 的 inner_text('body')（3 秒超时 + 整棵 DOM 遍历），单个元素要十几秒；
    改成在页面里直接取 innerText 的前 2000 字，一次 round-trip，够判断"文本有没有明显变化"。
    """
    try:
        return page.evaluate(
            "() => { const t = document.body.innerText || ''; return t.length + '|' + t.slice(0, 2000); }")
    except Exception:
        return ''


def svg_signature(page) -> str:
    return page.evaluate(
        "(document.querySelector('.network-svg')||{}).outerHTML ? "
        "document.querySelector('.network-svg').getAttribute('viewBox') + '|' + "
        "(document.querySelector('.network-svg g')?.getAttribute('transform')||'') : ''")


def clipboard_text(page) -> str:
    """「复制接口地址」这类按钮只会写剪贴板，页面上看不出变化，必须单独读一次。"""
    try:
        return page.evaluate("async () => { try { return await navigator.clipboard.readText(); } catch (e) { return ''; } }") or ''
    except Exception:
        return ''


def collect(page, page_id: str) -> list[tuple[int, str]]:
    count = page.locator(SELECTOR).count()
    names: list[tuple[int, str]] = []
    for i in range(count):
        element = page.locator(SELECTOR).nth(i)
        try:
            name = (element.inner_text(timeout=1500) or '').strip().split('\n')[0]
        except Exception:
            name = ''
        aria = element.get_attribute('aria-label') or element.get_attribute('title') or ''
        names.append((i, name or aria or '(无文字)'))
    return names


def main() -> int:
    pages = [p for p in PAGES if not ARGS.pages or p[0] in {x.strip() for x in ARGS.pages.split(',') if x.strip()}]
    if not pages:
        log(f'没有匹配的页面：{ARGS.pages}')
        return 2

    report: list[dict] = []
    errors: list[str] = []
    pre_login_noise: list[str] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True,
                                  permissions=['clipboard-read', 'clipboard-write'])
        page = ctx.new_page()
        page.set_default_timeout(15000)

        requests: list[str] = []
        downloads: list[str] = []
        bad: list[str] = []
        popups: list[str] = []
        logged_in = {'ok': False}

        def on_console(message):
            if message.type != 'error':
                return
            if logged_in['ok']:
                errors.append(message.text)
            else:
                pre_login_noise.append(message.text)

        page.on('request', lambda r: requests.append(r.url) if '/api/v1' in r.url else None)
        page.on('download', lambda d: downloads.append(d.suggested_filename))
        page.on('response', lambda r: bad.append(f'{r.status} {r.request.method} {r.url}')
                if r.status >= 400 and '/api/v1' in r.url else None)
        ctx.on('page', lambda new: popups.append(new.url or 'about:blank'))
        page.on('console', on_console)

        log(f'目标 {BASE}  页面 {len(pages)} 个  输出 {OUT}')
        page.goto(BASE, wait_until='networkidle', timeout=60000)
        page.fill('#ct-email', ARGS.email)
        page.fill('#ct-password', ARGS.password)
        page.click('button[type=submit]')
        page.wait_for_selector('text=总览工作台', timeout=60000)
        logged_in['ok'] = True
        log('登录成功')

        for page_id, label in pages:
            page.goto(f'{BASE}/#{page_id}', wait_until='networkidle', timeout=60000)
            try:
                page.wait_for_selector('.page-body', timeout=30000)
            except Exception:
                log(f'[{page_id}] 页面没加载出来，跳过')
                continue
            page.wait_for_timeout(800)
            names = collect(page, page_id)
            if ARGS.max_elements:
                names = names[:ARGS.max_elements]
            log(f'[{page_id}] {label}：{len(names)} 个可点元素')
            dirty = False

            for order, (i, name) in enumerate(names, start=1):
                if name in SKIP_NAMES:
                    continue
                # 只在"状态被打乱"时重载：切了页、列表长度变了、弹层关不掉。
                # 每次都重载虽然最稳，但 250 个元素要一个多小时，现场等不起。
                if dirty:
                    try:
                        # 只改 hash 的 goto 是同文档导航、不会重载，必须带变化的 query
                        page.goto(f'{BASE}/?reload={page_id}-{order}#{page_id}', wait_until='domcontentloaded', timeout=30000)
                        page.wait_for_selector('.page-body', timeout=15000)
                    except Exception:
                        log(f'  [{page_id}] 第 {order} 个之前重载失败，跳过该页剩余')
                        break
                    page.wait_for_timeout(450)
                    dirty = False
                try:
                    page.evaluate("document.querySelectorAll('.toast button').forEach(b => b.click())")
                except Exception:
                    pass

                element = page.locator(SELECTOR).nth(i)
                if element.count() == 0:
                    report.append({'page': page_id, 'index': i, 'name': name, 'state': 'no-op',
                                   'detail': 'DOM 重新渲染后找不到该元素'})
                    continue
                try:
                    before_hash = page.evaluate('location.hash')
                    before_svg = svg_signature(page)
                    before_sig = body_signature(page)
                    before_clip = clipboard_text(page)
                    before_req, before_dl, before_pop, before_bad = len(requests), len(downloads), len(popups), len(bad)
                    disabled = element.evaluate('(e)=>!!e.disabled')
                    target_blank = element.evaluate('(e)=>e.tagName==="A" && (e.target==="_blank" || (e.getAttribute("href")||"").startsWith("http"))')
                    aria_pressed = element.evaluate('(e)=>e.getAttribute("aria-pressed")==="true" || e.classList.contains("active") || e.classList.contains("selected")')
                except Exception as exc:
                    report.append({'page': page_id, 'index': i, 'name': name, 'state': 'click-failed',
                                   'detail': f'读取状态失败 {str(exc)[:80]}'})
                    continue

                if disabled:
                    report.append({'page': page_id, 'index': i, 'name': name, 'state': 'ok',
                                   'reacted': {'disabled': True}, 'disabled': True, 'modal_after': 0})
                    log(f'  [{page_id}] {order}/{len(names)} {name[:24]} → 按设计禁用')
                    continue

                clicked = False
                try:
                    element.click(timeout=5000, no_wait_after=True)
                    clicked = True
                except Exception as exc:
                    # 覆盖层挡住等一次性失败：重载后重试一次
                    try:
                        page.keyboard.press('Escape')
                        page.wait_for_timeout(200)
                        element.click(timeout=5000, no_wait_after=True)
                        clicked = True
                    except Exception:
                        report.append({'page': page_id, 'index': i, 'name': name, 'state': 'click-failed',
                                       'detail': str(exc)[:120], 'disabled': disabled})
                        log(f'  [{page_id}] {order}/{len(names)} {name[:24]} → 点不到')
                        dirty = True
                        continue

                page.wait_for_timeout(ARGS.settle_ms)
                # 有些导航按钮要等一次接口回来才改 hash，多等一会儿再看
                try:
                    page.wait_for_load_state('networkidle', timeout=2500)
                except Exception:
                    pass
                try:
                    after_hash = page.evaluate('location.hash')
                    after_sig = body_signature(page)
                    after_svg = svg_signature(page)
                    after_clip = clipboard_text(page)
                    modal = page.locator('.modal:visible, .drawer:visible').count()
                    toast = page.locator('.toast:visible').count()
                    aria_after = element.evaluate('(e)=>e.getAttribute("aria-pressed")==="true" || e.classList.contains("active") || e.classList.contains("selected")')
                except Exception:
                    after_hash, after_sig, after_svg, after_clip, modal, toast = before_hash, before_sig, before_svg, before_clip, 0, 0
                    aria_after = False

                reacted = {
                    'hash': after_hash != before_hash,
                    'modal': modal > 0,
                    'toast': toast > 0,
                    'request': len(requests) > before_req,
                    'download': len(downloads) > before_dl,
                    'dom': after_sig != before_sig,
                    'svg': after_svg != before_svg,
                    'popup': len(popups) > before_pop,
                    'error': len(bad) > before_bad,
                    'clipboard': bool(after_clip) and after_clip != before_clip,
                    # 筛选按钮：结果集可能没变，但按钮自己变成选中态，这也算真实反应
                    'active': bool(aria_after) and not aria_pressed,
                }
                useful = any(reacted.values()) or aria_pressed or target_blank
                if not useful:
                    # 按下标可能点到了"同名元素的另一份"（列表重排、重复标签、图标在文字外层）。
                    # 再按文字（子串，和脚本开头取名的方式一致）点第 k 个同名元素；
                    # 点了还是没反应才算真死按钮。
                    try:
                        same_name = [row for row in names if row[1] == name]
                        k = next((idx for idx, row in enumerate(same_name) if row[0] == i), 0)
                        alt = page.locator(SELECTOR).filter(has_text=name)
                        if alt.count() == 0:
                            safe = name.replace('"', '\\"')
                            alt = page.locator(f'.page-body [aria-label="{safe}"]:visible')
                        if alt.count() > k:
                            alt.nth(k).click(timeout=4000, no_wait_after=True)
                            page.wait_for_timeout(1000)
                            retry_hash = page.evaluate('location.hash')
                            retry_sig = body_signature(page)
                            retry_modal = page.locator('.modal:visible, .drawer:visible').count()
                            if retry_hash != before_hash or retry_sig != before_sig or retry_modal:
                                after_hash, after_sig, modal = retry_hash, retry_sig, retry_modal
                                reacted['hash'] = retry_hash != before_hash
                                reacted['dom'] = retry_sig != before_sig
                                reacted['modal'] = retry_modal > 0
                                useful = True
                        else:
                            log(f'  [{page_id}] 复测跳过：匹配到 {alt.count()} 个同名元素，k={k}')
                    except Exception as exc:
                        log(f'  [{page_id}] 复测失败：{str(exc)[:90]}')
                state = 'ok' if useful else 'no-op'
                report.append({
                    'page': page_id, 'index': i, 'name': name, 'state': state,
                    'reacted': reacted, 'disabled': False, 'modal_after': modal,
                    'debug': None if useful else {
                        'beforeHash': before_hash, 'afterHash': after_hash,
                        'beforeLen': len(before_sig), 'afterLen': len(after_sig),
                    },
                })
                flag = '有反应' if useful else '无反应'
                log(f'  [{page_id}] {order}/{len(names)} {name[:24]} → {flag}')
                if len(bad) > before_bad:
                    report.append({'page': page_id, 'index': i, 'name': name, 'state': 'http-error',
                                   'detail': '; '.join(bad[before_bad:])[:200]})
                # 只有真的跳页 / 列表长度变化才重载。开弹层用 Escape 关掉即可——以前每点一个就整页重载，
                # 单个元素 20 秒起步，全量要一个多小时。
                if after_hash != before_hash:
                    dirty = True
                try:
                    current_count = page.locator(SELECTOR).count()
                except Exception:
                    current_count = -1
                if current_count != len(names):
                    dirty = True
                # 筛选类按钮会改变列表长度，后续元素的下标就错位了，必须回到初始状态再点下一个
                if reacted['dom'] and not modal:
                    dirty = True
                try:
                    page.keyboard.press('Escape')
                except Exception:
                    pass
                if modal:
                    page.wait_for_timeout(150)
                    if page.locator('.modal:visible, .drawer:visible').count():
                        dirty = True
                if clicked and reacted['popup']:
                    for extra in ctx.pages[1:]:
                        try:
                            extra.close()
                        except Exception:
                            pass

            OUT.parent.mkdir(parents=True, exist_ok=True)
            OUT.write_text(json.dumps({'report': report, 'consoleErrors': errors[:40],
                                       'finishedAt': time.strftime('%Y-%m-%dT%H:%M:%S')},
                                      ensure_ascii=False, indent=2), encoding='utf-8')
            log(f'[{page_id}] 阶段性结果已写入 {OUT}')

        # ---- 第二轮：对"无反应"的元素单独复核 ----
        # 一路上点过十几个按钮之后，页面可能停在某个筛选/弹层残留状态，
        # 这时再点导航类按钮可能不触发。单独打开一页只点它一次，能区分
        # "按钮本身是死的" 与 "顺序点击的副作用"。
        dead_rows = [row for row in report if row['state'] == 'no-op' and row.get('index') is not None]
        if dead_rows:
            log(f'\n第二轮：单独复核 {len(dead_rows)} 个"无反应"元素')
        for row in dead_rows:
            page_id = row['page']
            try:
                page.goto(f'{BASE}/?isolate={page_id}#{page_id}', wait_until='domcontentloaded', timeout=30000)
                page.wait_for_selector('.page-body', timeout=15000)
                page.wait_for_timeout(700)
                target = page.locator(SELECTOR).nth(row['index'])
                if target.count() == 0:
                    log(f'  [{page_id}] {row["name"][:24]} → 单独复核也找不到')
                    continue
                before_hash = page.evaluate('location.hash')
                before_sig = body_signature(page)
                before_req = len(requests)
                target.click(timeout=5000, no_wait_after=True)
                page.wait_for_timeout(1000)
                after_hash = page.evaluate('location.hash')
                after_sig = body_signature(page)
                modal = page.locator('.modal:visible, .drawer:visible').count()
                if after_hash != before_hash or after_sig != before_sig or modal or len(requests) > before_req:
                    row['state'] = 'ok'
                    row['isolated'] = True
                    row['reacted'] = {'hash': after_hash != before_hash, 'dom': after_sig != before_sig,
                                      'modal': modal > 0, 'request': len(requests) > before_req}
                    row['debug'] = None
                    log(f'  [{page_id}] {row["name"][:24]} → 单独复核有反应（顺序点击时未触发）')
                else:
                    log(f'  [{page_id}] {row["name"][:24]} → 单独复核仍然无反应')
            except Exception as exc:
                log(f'  [{page_id}] {row["name"][:24]} → 复核失败 {str(exc)[:60]}')

        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps({'report': report, 'consoleErrors': errors[:40],
                                   'finishedAt': time.strftime('%Y-%m-%dT%H:%M:%S')},
                                  ensure_ascii=False, indent=2), encoding='utf-8')
        log(f'最终结果已写入 {OUT}')
        browser.close()

    dead = [row for row in report if row['state'] == 'no-op']
    failed = [row for row in report if row['state'] == 'click-failed']
    http_errors = [row for row in report if row['state'] == 'http-error']
    ok = sum(1 for r in report if r['state'] == 'ok')

    log('')
    log(f'共测 {len(report)} 个可点击元素：有反应 {ok}，无反应 {len(dead)}，点击失败 {len(failed)}，接口报错 {len(http_errors)}')
    for row in dead:
        log(f'  [无反应] {row["page"]:12s} {row["name"][:40]}')
    for row in failed:
        log(f'  [点不到] {row["page"]:12s} {row["name"][:40]} :: {row["detail"][:80]}')
    for row in http_errors:
        log(f'  [接口报错] {row["page"]:12s} {row["name"][:30]} :: {row["detail"][:100]}')
    log(f'登录前预期噪音（未登录 bootstrap 401）：{len(pre_login_noise)} 条')
    if errors:
        log(f'控制台错误 {len(errors)} 条，前 5 条：')
        for line in errors[:5]:
            log('   - ' + line[:140])
    log(f'明细写入 {OUT}')
    return 0 if not dead and not failed else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        raise SystemExit(3)

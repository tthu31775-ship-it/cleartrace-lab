# -*- coding: utf-8 -*-
"""逐个点击工作台里所有可交互元素,判断"有没有用"。

判定标准(任一成立即算有反应):
  1. URL hash 变化(切页)  2. 弹出模态/抽屉  3. 出现 toast  4. 发出新的 API 请求
  5. 触发下载              6. DOM 文本发生明显变化
无反应的按钮会被列出来,用于修掉"只能看前端"的死按钮。

用法: python scripts/audit-ui.py http://127.0.0.1:3100 [输出json]
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
import time

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3100'
OUT = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else '/tmp/ui-audit.json')

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


def body_signature(page) -> str:
    try:
        text = page.inner_text('body', timeout=3000)
        active = page.evaluate("Array.from(document.querySelectorAll('.tabs-line .active, .segmented .active')).map(e=>e.innerText).join(',')")
    except Exception:
        return ''
    return re.sub(r'\s+', '', text)[:4000] + '|active:' + (active or '')


def main() -> int:
    report: list[dict] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True, permissions=['clipboard-read', 'clipboard-write'])
        page = ctx.new_page()
        requests: list[str] = []
        page.on('request', lambda r: requests.append(r.url) if '/api/v1' in r.url else None)
        downloads: list[str] = []
        page.on('download', lambda d: downloads.append(d.suggested_filename))
        bad: list[str] = []
        page.on('response', lambda r: bad.append(f'{r.status} {r.request.method} {r.url}') if r.status >= 400 and '/api/v1' in r.url else None)
        popups: list[str] = []
        ctx.on('page', lambda new: popups.append(new.url or 'about:blank'))
        errors: list[str] = []
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

        page.goto(BASE, wait_until='networkidle')
        page.fill('#ct-email', 'admin@cleartrace.local')
        page.fill('#ct-password', 'ClearTrace2026')
        page.click('button[type=submit]')
        page.wait_for_selector('text=总览工作台', timeout=60000)

        for page_id, label in PAGES:
            page.goto(f'{BASE}/#{page_id}', wait_until='networkidle')
            page.wait_for_selector('.page-body', timeout=30000)
            page.wait_for_timeout(1000)
            count = page.locator(SELECTOR).count()
            names = []
            for i in range(count):
                el = page.locator(SELECTOR).nth(i)
                try:
                    name = (el.inner_text(timeout=1500) or '').strip().split('\n')[0]
                except Exception:
                    name = ''
                aria = el.get_attribute('aria-label') or el.get_attribute('title') or ''
                names.append((i, name or aria or '(无文字)'))
            for i, name in names:
                # 每点一个都回到页面初始状态,避免状态互相污染
                page.goto(f'{BASE}/#{page_id}', wait_until='domcontentloaded')
                try:
                    page.wait_for_selector('.page-body', timeout=15000)
                except Exception:
                    continue
                page.wait_for_timeout(700)
                # 关掉可能挡住点击的提示条
                page.evaluate("document.querySelectorAll('.toast button').forEach(b => b.click())")
                if name in SKIP_NAMES:
                    continue
                el = page.locator(SELECTOR).nth(i)
                if el.count() == 0:
                    continue
                before_hash = page.evaluate('location.hash')
                before_svg = page.evaluate("(document.querySelector('.network-svg')||{}).outerHTML ? document.querySelector('.network-svg').getAttribute('viewBox') + '|' + (document.querySelector('.network-svg g')?.getAttribute('transform')||'') : ''")
                before_sig = body_signature(page)
                before_req = len(requests)
                before_dl = len(downloads)
                before_pop = len(popups)
                before_bad = len(bad)
                disabled = el.evaluate('(e)=>!!e.disabled')
                target_blank = el.evaluate('(e)=>e.tagName==="A" && (e.target==="_blank" || (e.getAttribute("href")||"").startsWith("http"))')
                aria_pressed = el.evaluate('(e)=>e.getAttribute("aria-pressed")==="true" || e.classList.contains("active") || e.classList.contains("selected")')
                if disabled:
                    report.append({'page': page_id, 'index': i, 'name': name, 'state': 'ok', 'reacted': {'disabled': True}, 'disabled': True, 'modal_after': 0})
                    continue
                try:
                    el.click(timeout=4000, no_wait_after=True)
                except Exception as exc:  # 覆盖层挡住等
                    report.append({'page': page_id, 'index': i, 'name': name, 'state': 'click-failed', 'detail': str(exc)[:120], 'disabled': disabled})
                    continue
                page.wait_for_timeout(1100)
                after_hash = page.evaluate('location.hash')
                after_sig = body_signature(page)
                after_svg = page.evaluate("(document.querySelector('.network-svg')||{}).outerHTML ? document.querySelector('.network-svg').getAttribute('viewBox') + '|' + (document.querySelector('.network-svg g')?.getAttribute('transform')||'') : ''")
                modal = page.locator('.modal:visible, .drawer:visible').count()
                toast = page.locator('.toast:visible').count()
                changed = abs(len(after_sig) - len(before_sig)) > 0 or after_sig != before_sig
                reacted = {
                    'hash': after_hash != before_hash,
                    'modal': modal > 0,
                    'toast': toast > 0,
                    'request': len(requests) > before_req,
                    'download': len(downloads) > before_dl,
                    'dom': changed,
                    'svg': after_svg != before_svg,
                    'popup': len(popups) > before_pop,
                    'error': len(bad) > before_bad,
                }
                useful = any(reacted.values()) or disabled or aria_pressed or target_blank
                report.append({
                    'page': page_id, 'index': i, 'name': name,
                    'state': 'ok' if useful else ('disabled' if disabled else 'no-op'),
                    'reacted': reacted, 'disabled': disabled,
                    'modal_after': modal,
                })
                if len(bad) > before_bad:
                    report.append({'page': page_id, 'index': i, 'name': name, 'state': 'http-error', 'detail': '; '.join(bad[before_bad:])[:200]})
                if modal:
                    page.keyboard.press('Escape')
                    page.wait_for_timeout(300)
        browser.close()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({'report': report, 'consoleErrors': errors[:40]}, ensure_ascii=False, indent=2), encoding='utf-8')

    dead = [row for row in report if row['state'] == 'no-op']
    failed = [row for row in report if row['state'] == 'click-failed']
    print(f'共测 {len(report)} 个可点击元素:有反应 {sum(1 for r in report if r["state"] == "ok")}, 无反应 {len(dead)}, 点击失败 {len(failed)}')
    for row in dead:
        print(f'  [无反应] {row["page"]:12s} {row["name"][:34]}')
    for row in failed:
        print(f'  [点不到] {row["page"]:12s} {row["name"][:34]} :: {row["detail"][:60]}')
    if errors:
        print(f'控制台错误 {len(errors)} 条,前 5 条:')
        for line in errors[:5]:
            print('   -', line[:120])
    print(f'明细写入 {OUT}')
    return 0 if not dead else 1


if __name__ == '__main__':
    raise SystemExit(main())

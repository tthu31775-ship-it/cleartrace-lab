# -*- coding: utf-8 -*-
"""全流程演练：模拟"别人拿到账号后在浏览器里跑一遍"。

覆盖 6 个关键动作，全部走真实接口：
  1. 登录        2. 协同线索列表 + 打开详情（图谱/成员/原文）
  3. 评论检测（写库）   4. 事件扫描（写库）   5. 导出 CSV（下载）   6. 模型自检

用法：
    python scripts/walkthrough.py http://127.0.0.1:3000 admin@cleartrace.local ClearTrace2026
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3000').rstrip('/')
EMAIL = sys.argv[2] if len(sys.argv) > 2 else 'admin@cleartrace.local'
PASSWORD = sys.argv[3] if len(sys.argv) > 3 else 'ClearTrace2026'
SHOTS = Path(sys.argv[4] if len(sys.argv) > 4 else 'docs/handoff/shots/walkthrough')

steps: list[tuple[bool, str, str]] = []


def check(name: str, ok: bool, detail: str = '') -> None:
    steps.append((ok, name, detail))
    print(f"  {'✓' if ok else '✗'} {name}" + (f'  [{detail}]' if detail else ''))


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    console_errors: list[str] = []
    logged_in = {'ok': False}

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        page = ctx.new_page()
        page.set_default_timeout(30000)

        def on_console(message):
            if message.type == 'error' and logged_in['ok']:
                console_errors.append(message.text)

        page.on('console', on_console)

        print(f'目标 {BASE}')
        page.goto(BASE, wait_until='networkidle')
        page.fill('#ct-email', EMAIL)
        page.fill('#ct-password', PASSWORD)
        page.click('button[type=submit]')
        page.wait_for_selector('text=总览工作台', timeout=60000)
        logged_in['ok'] = True
        check('1 登录成功', True, page.locator('.side-nav .active, .metric-card').first.inner_text()[:20])
        page.screenshot(path=str(SHOTS / '1-overview.png'), full_page=False)

        # 2 协同线索 + 详情
        page.click('text=协同线索')
        page.wait_for_selector('text=协同线索库', timeout=45000)
        page.wait_for_selector('table tbody tr', timeout=45000)
        rows = page.locator('table tbody tr').count()
        stats = page.locator('.metric-card strong').all_inner_texts()
        total = next((int(s) for s in stats if s.strip().isdigit()), 0)
        # 首次启动是 803；跑过扫描/验收之后会变成 804+，那是真实写入的结果，不是数据错
        check('2 线索列表', rows > 0 and total >= 803, f'{rows} 行 / 指标 {stats}')
        page.locator('table tbody tr').first.locator('button.text-link').click()
        page.wait_for_selector('text=成员表', timeout=45000)
        page.wait_for_selector('.network-svg circle', timeout=45000)
        nodes = page.locator('.network-svg circle').count()
        check('3 线索详情含图谱与成员', nodes > 0, f'{nodes} 个节点')
        page.screenshot(path=str(SHOTS / '2-lead-detail.png'), full_page=False)
        page.click('.modal-head button[aria-label=关闭]')
        page.wait_for_timeout(600)

        # 4 评论检测（写库）
        page.click('text=评论检测')
        page.wait_for_selector('text=单条检测', timeout=45000)
        page.locator('textarea').first.fill('兄弟们冲！统一口径刷起来，九点准时集合！！！')
        page.click('text=开始检测')
        page.wait_for_selector('text=本次结果', timeout=60000)
        page.wait_for_timeout(800)
        score = page.locator('.result-score, .score-value, .metric-card strong').first.inner_text()
        check('4 评论检测返回分数并落库', bool(score.strip()), f'分数 {score.strip()[:12]}')
        page.screenshot(path=str(SHOTS / '3-screening.png'), full_page=True)

        # 5 事件扫描（写库）
        page.click('text=事件扫描')
        page.wait_for_selector('text=评论输入', timeout=45000)
        if page.locator('text=开始扫描并入库').count():
            page.click('text=开始扫描并入库')
            page.wait_for_selector('text=本次扫描结果', timeout=90000)
            page.wait_for_timeout(600)
            check('5 事件扫描落库', True, '出现"本次扫描结果"')
            page.screenshot(path=str(SHOTS / '4-scan.png'), full_page=True)
        else:
            check('5 事件扫描落库', False, '找不到扫描按钮')

        # 6 导出 CSV（下载）
        page.click('text=数据导出')
        page.wait_for_selector('text=逐表下载', timeout=45000)
        with page.expect_download(timeout=45000) as download_info:
            page.locator('table.data-table tbody tr').first.locator('button, a').first.click()
        download = download_info.value
        saved = SHOTS / 'leads-export.csv'
        download.save_as(str(saved))
        size = saved.stat().st_size
        check('6 导出 CSV 可下载', size > 1000, f'{download.suggested_filename} / {size} 字节')

        # 7 模型自检
        page.click('text=模型接入')
        page.wait_for_selector('text=五种能力', timeout=45000)
        page.click('text=运行自检')
        page.wait_for_timeout(2500)
        caps = page.locator('.integration-card').count()
        check('7 能力卡与自检', caps >= 4, f'{caps} 张卡')
        page.screenshot(path=str(SHOTS / '5-models.png'), full_page=True)

        browser.close()

    passed = sum(1 for ok, _, _ in steps if ok)
    print(f'\n控制台错误（登录后）：{len(console_errors)}')
    for line in console_errors[:3]:
        print('   -', line[:120])
    print(f'合计：通过 {passed} / 失败 {len(steps) - passed}')
    return 0 if passed == len(steps) and not console_errors else 1


if __name__ == '__main__':
    raise SystemExit(main())


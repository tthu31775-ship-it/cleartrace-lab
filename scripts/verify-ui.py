# -*- coding: utf-8 -*-
"""浏览器端验证:登录 → 协同线索 → 线索详情 → 评论检测 → 模型接入,并截图。

用法: python scripts/verify-ui.py http://127.0.0.1:3100 [输出目录]
"""
from __future__ import annotations

import sys
import pathlib
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3100'
OUT = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else '/tmp/ct-shots')
OUT.mkdir(parents=True, exist_ok=True)

console_errors: list[str] = []
failed_requests: list[str] = []
# 登录前页面会请求 /api/v1/bootstrap 拿当前会话，未登录必然 401。这是预期行为，
# 不能算作“控制台错误”，否则验收脚本永远退出码 1（历史上就是这样被误判的）。
pre_login_noise: list[str] = []
STATE = {'logged_in': False}


def _on_console(message) -> None:
    if message.type != 'error':
        return
    (console_errors if STATE['logged_in'] else pre_login_noise).append(message.text)


def _on_request_failed(request) -> None:
    entry = f'{request.method} {request.url} :: {request.failure}'
    (failed_requests if STATE['logged_in'] else pre_login_noise).append(entry)


def main() -> int:
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.on('console', _on_console)
        page.on('requestfailed', _on_request_failed)

        page.goto(BASE, wait_until='networkidle')
        page.fill('#ct-email', 'admin@cleartrace.local')
        page.fill('#ct-password', 'ClearTrace2026')
        page.click('button[type=submit]')
        page.wait_for_selector('text=总览工作台', timeout=45000)
        STATE['logged_in'] = True
        print('登录成功')

        # 协同线索
        page.click('text=协同线索')
        page.wait_for_selector('text=协同线索库', timeout=45000)
        page.wait_for_selector('table tbody tr', timeout=45000)
        rows = page.locator('table tbody tr').count()
        stats = page.locator('.metric-card strong').all_inner_texts()
        print(f'线索列表行数 {rows} 指标卡 {stats}')
        page.screenshot(path=str(OUT / '01-leads.png'), full_page=False)

        # 线索详情
        page.locator('table tbody tr').first.locator('button.text-link').click()
        page.wait_for_selector('text=成员表', timeout=45000)
        page.wait_for_selector('.network-svg circle', timeout=45000)
        circles = page.locator('.network-svg circle').count()
        print(f'图谱节点 {circles}')
        page.screenshot(path=str(OUT / '02-lead-detail.png'), full_page=False)
        page.click('.modal-head button[aria-label=关闭]')
        page.wait_for_timeout(800)

        # 评论检测
        page.click('text=评论检测')
        page.wait_for_selector('text=单条检测', timeout=45000)
        page.locator('textarea').first.fill('水军集合！！兄弟们冲！统一口径刷起来！！！')
        page.click('text=开始检测')
        page.wait_for_selector('text=本次结果', timeout=60000)
        page.wait_for_timeout(800)
        page.screenshot(path=str(OUT / '03-screening.png'), full_page=True)

        # 事件扫描
        page.click('text=事件扫描')
        page.wait_for_selector('text=评论输入', timeout=45000)
        page.click('text=开始扫描并入库')
        page.wait_for_selector('text=本次扫描结果', timeout=90000)
        page.wait_for_timeout(600)
        leads_found = page.locator('.badge', has_text='组候选').count()
        print(f'扫描结果区块 {leads_found}')
        page.screenshot(path=str(OUT / '05-scan.png'), full_page=True)

        # 数据导出
        page.click('text=数据导出')
        page.wait_for_selector('text=逐表下载', timeout=45000)
        page.wait_for_selector('text=整库备份', timeout=45000)
        rows = page.locator('table.data-table tbody tr').count()
        print(f'导出对象 {rows} 行')
        page.screenshot(path=str(OUT / '06-exports.png'), full_page=True)

        # 模型接入
        page.click('text=模型接入')
        page.wait_for_selector('text=五种能力', timeout=45000)
        caps = page.locator('.integration-card').count()
        print(f'能力卡 {caps}')
        page.screenshot(path=str(OUT / '04-models.png'), full_page=True)

        browser.close()

    print('\n登录前预期噪音(未登录 bootstrap 401):', len(pre_login_noise))
    print('控制台错误:', len(console_errors))
    for line in console_errors[:10]:
        print('  -', line[:200])
    print('失败请求:', len(failed_requests))
    for line in failed_requests[:10]:
        print('  -', line[:200])
    ok = not console_errors and not failed_requests
    print('UI 验收:', '通过' if ok else '失败')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())

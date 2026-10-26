import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '清源 ClearTrace · 网络水军摸排工作台', description: '连接数据、识别任务与人工复核的协作工作空间。', icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' } };
export default function RootLayout({ children }: {
    children: React.ReactNode;
}) { return <html lang="zh-CN"><body>{children}</body></html>; }

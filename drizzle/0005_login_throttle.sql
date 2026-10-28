-- 登录失败限速：记录每次失败，10 分钟内同一「账号 + 来源地址」失败 10 次后返回 429。
-- 只统计失败：正确口令永远放行，避免把自己锁在门外。
CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  ip TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS login_attempts_lookup ON login_attempts(email, ip, created_at);

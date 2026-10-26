-- 0002:独立账号登录与本地会话
-- 保留原九张业务表;新增成员密码凭证与服务端会话。
ALTER TABLE `members` ADD `password_hash` text;
ALTER TABLE `members` ADD `password_salt` text;
ALTER TABLE `members` ADD `password_iterations` integer;
ALTER TABLE `members` ADD `activated_at` text;
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `member_id` text NOT NULL,
  `token_hash` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `revoked_at` text,
  `user_agent` text,
  FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS `sessions_token_unique` ON `sessions` (`token_hash`);
CREATE INDEX IF NOT EXISTS `sessions_member_idx` ON `sessions` (`member_id`);

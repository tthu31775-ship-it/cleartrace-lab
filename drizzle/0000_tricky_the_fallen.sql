CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset_id` text NOT NULL,
	`account_id` text NOT NULL,
	`display_name` text NOT NULL,
	`platform` text NOT NULL,
	`features` text NOT NULL,
	`related_ids` text DEFAULT '[]' NOT NULL,
	`risk_score` real,
	`risk_level` text DEFAULT 'unscored' NOT NULL,
	`review_status` text DEFAULT 'unreviewed' NOT NULL,
	`reasons` text DEFAULT '[]' NOT NULL,
	`demo` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`dataset_id`) REFERENCES `datasets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_dataset_account_unique` ON `accounts` (`dataset_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `accounts_risk_idx` ON `accounts` (`risk_level`);--> statement-breakpoint
CREATE INDEX `accounts_dataset_idx` ON `accounts` (`dataset_id`);--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`status` text DEFAULT 'success' NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	`format` text NOT NULL,
	`version` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`record_count` integer DEFAULT 0 NOT NULL,
	`demo` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_email_unique` ON `members` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_user_unique` ON `members` (`user_id`);--> statement-breakpoint
CREATE TABLE `results` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`account_id` text NOT NULL,
	`score` real NOT NULL,
	`risk_level` text NOT NULL,
	`reasons` text NOT NULL,
	`model_version` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `results_task_account_unique` ON `results` (`task_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `results_task_idx` ON `results` (`task_id`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`status` text NOT NULL,
	`note` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`reviewer_name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reviews_account_idx` ON `reviews` (`account_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`dataset_id` text NOT NULL,
	`model_id` text NOT NULL,
	`threshold` integer DEFAULT 65 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`suspected_count` integer DEFAULT 0 NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`created_by` text NOT NULL,
	`demo` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`dataset_id`) REFERENCES `datasets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);
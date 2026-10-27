-- 评论、事件、协同群组与图谱落库(规划 §6 的六类业务表)。
-- 全部为增量新增,不改写 0000/0001/0002 已应用的迁移。

CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset_id` text,
	`source_namespace` text NOT NULL,
	`source_file` text NOT NULL,
	`event_line` integer NOT NULL,
	`event_ref` text NOT NULL,
	`native_work_id` text,
	`title` text DEFAULT '' NOT NULL,
	`lead_count` integer DEFAULT 0 NOT NULL,
	`node_count` integer DEFAULT 0 NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`max_accounts` integer DEFAULT 0 NOT NULL,
	`lead_node_count` integer DEFAULT 0 NOT NULL,
	`time_min` real,
	`time_max` real,
	`time_precision` text DEFAULT 'minute' NOT NULL,
	`graph_path` text NOT NULL,
	`graph_json` text DEFAULT '{}' NOT NULL,
	`import_batch` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_source_unique` ON `events` (`source_namespace`,`event_line`);--> statement-breakpoint
CREATE INDEX `events_batch_idx` ON `events` (`import_batch`);--> statement-breakpoint
CREATE INDEX `events_nodes_idx` ON `events` (`node_count`);--> statement-breakpoint

CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text,
	`dataset_id` text,
	`platform` text DEFAULT 'unknown' NOT NULL,
	`source_namespace` text NOT NULL,
	`source_comment_key` text NOT NULL,
	`source_account_key` text NOT NULL,
	`account_namespace` text NOT NULL,
	`author_name` text DEFAULT '' NOT NULL,
	`content` text NOT NULL,
	`publish_time` real,
	`publish_time_iso` text,
	`time_precision` text DEFAULT 'unknown' NOT NULL,
	`timezone` text DEFAULT 'unknown' NOT NULL,
	`reply_to_key` text,
	`like_count` integer,
	`like_known` integer DEFAULT 0 NOT NULL,
	`ip_region` text,
	`source_locator` text DEFAULT '' NOT NULL,
	`import_batch` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comments_idempotent_unique` ON `comments` (`source_namespace`,`source_comment_key`);--> statement-breakpoint
CREATE INDEX `comments_event_time_idx` ON `comments` (`event_id`,`publish_time`);--> statement-breakpoint
CREATE INDEX `comments_account_idx` ON `comments` (`account_namespace`,`source_account_key`);--> statement-breakpoint
CREATE INDEX `comments_created_idx` ON `comments` (`created_at`);--> statement-breakpoint

CREATE TABLE `comment_predictions` (
	`id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`run_id` text NOT NULL,
	`capability` text DEFAULT 'comment_classification' NOT NULL,
	`model_version` text NOT NULL,
	`raw_score` real,
	`threshold` real NOT NULL,
	`label` text NOT NULL,
	`risk_level` text NOT NULL,
	`confidence` text NOT NULL,
	`evidence` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `predictions_idempotent_unique` ON `comment_predictions` (`comment_id`,`model_version`,`run_id`);--> statement-breakpoint
CREATE INDEX `predictions_run_idx` ON `comment_predictions` (`run_id`);--> statement-breakpoint
CREATE INDEX `predictions_created_idx` ON `comment_predictions` (`created_at`);--> statement-breakpoint
CREATE INDEX `predictions_label_idx` ON `comment_predictions` (`label`,`risk_level`);--> statement-breakpoint

CREATE TABLE `coordination_leads` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`event_id` text NOT NULL,
	`source_namespace` text NOT NULL,
	`event_line` integer NOT NULL,
	`lead_number` integer NOT NULL,
	`representative_text` text DEFAULT '' NOT NULL,
	`account_count` integer DEFAULT 0 NOT NULL,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`start_time` real,
	`end_time` real,
	`min_similarity` real,
	`score` real,
	`score_type` text DEFAULT 'heuristic' NOT NULL,
	`calibrated` integer DEFAULT 0 NOT NULL,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`review_note` text DEFAULT '' NOT NULL,
	`reviewer_id` text,
	`reviewer_name` text,
	`reviewed_at` text,
	`reviewed_run_id` text,
	`comments` text DEFAULT '[]' NOT NULL,
	`similarity_edges` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_idempotent_unique` ON `coordination_leads` (`run_id`,`event_id`,`lead_number`);--> statement-breakpoint
CREATE INDEX `leads_event_idx` ON `coordination_leads` (`event_id`);--> statement-breakpoint
CREATE INDEX `leads_review_idx` ON `coordination_leads` (`review_status`);--> statement-breakpoint
CREATE INDEX `leads_accounts_idx` ON `coordination_leads` (`account_count`);--> statement-breakpoint

CREATE TABLE `coordination_lead_members` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`member_key` text NOT NULL,
	`node_key` text,
	`account_namespace` text NOT NULL,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`first_time` real,
	`last_time` real,
	`similarity` real,
	`is_representative` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `coordination_leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_members_unique` ON `coordination_lead_members` (`lead_id`,`member_key`);--> statement-breakpoint
CREATE INDEX `lead_members_account_idx` ON `coordination_lead_members` (`account_namespace`,`member_key`);--> statement-breakpoint

CREATE TABLE `graph_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`run_id` text NOT NULL,
	`lead_id` text DEFAULT '' NOT NULL,
	`source_key` text NOT NULL,
	`target_key` text NOT NULL,
	`edge_type` text NOT NULL,
	`origin` text DEFAULT 'observed' NOT NULL,
	`weight` real,
	`created_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `graph_edges_event_idx` ON `graph_edges` (`event_id`,`edge_type`);--> statement-breakpoint
CREATE INDEX `graph_edges_lead_idx` ON `graph_edges` (`lead_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `graph_edges_unique` ON `graph_edges` (`event_id`,`edge_type`,`source_key`,`target_key`,`lead_id`);

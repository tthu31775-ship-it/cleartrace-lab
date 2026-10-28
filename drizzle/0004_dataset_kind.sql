-- 数据集类型:账号型(可建摸排任务)/ 评论型(抖音等)/ 线索型(协同预计算或扫描)
ALTER TABLE `datasets` ADD `kind` text DEFAULT 'accounts' NOT NULL;

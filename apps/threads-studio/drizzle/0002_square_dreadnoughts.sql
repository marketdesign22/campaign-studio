ALTER TABLE `settings` ADD `morningHour` int DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `morningMinute` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `eveningHour` int DEFAULT 18 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `eveningMinute` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `timezone` enum('LA','JP') DEFAULT 'LA' NOT NULL;
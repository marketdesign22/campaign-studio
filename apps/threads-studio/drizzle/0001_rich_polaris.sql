CREATE TABLE `post_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` int,
	`content` text NOT NULL,
	`status` enum('posted','error') NOT NULL,
	`threadsPostId` varchar(128),
	`errorMessage` text,
	`slot` enum('morning','evening','manual') NOT NULL DEFAULT 'manual',
	`postedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `post_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`content` text NOT NULL,
	`status` enum('pending','posted','error') NOT NULL DEFAULT 'pending',
	`scheduledSlot` enum('morning','evening') NOT NULL DEFAULT 'morning',
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `posts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`threadsAccessToken` text,
	`threadsUserId` varchar(64),
	`morningCronTaskUid` varchar(65),
	`eveningCronTaskUid` varchar(65),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `settings_id` PRIMARY KEY(`id`)
);

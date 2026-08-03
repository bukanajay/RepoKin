CREATE TABLE "relay_team_human_presence" (
	"environment_id" varchar(191) PRIMARY KEY,
	"active_at" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relay_team_messages" (
	"id" varchar(36) PRIMARY KEY,
	"recipient_environment_id" varchar(191) NOT NULL,
	"sender_environment_id" varchar(191) NOT NULL,
	"envelope_json" jsonb NOT NULL,
	"expires_at" varchar(64) NOT NULL,
	"created_at" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_relay_team_human_presence_active_at" ON "relay_team_human_presence" ("active_at");--> statement-breakpoint
CREATE INDEX "idx_relay_team_messages_recipient" ON "relay_team_messages" ("recipient_environment_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_relay_team_messages_expires_at" ON "relay_team_messages" ("expires_at");
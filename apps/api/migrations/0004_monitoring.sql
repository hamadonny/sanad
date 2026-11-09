CREATE TABLE "analytics_daily" (
	"day" date NOT NULL,
	"event" text NOT NULL,
	"platform" text NOT NULL,
	"app_version" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_daily_day_event_platform_app_version_pk" PRIMARY KEY("day","event","platform","app_version")
);
--> statement-breakpoint
CREATE TABLE "error_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"platform" text,
	"app_version" text,
	"fingerprint" text NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"context" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "error_events_created" ON "error_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "error_events_fp" ON "error_events" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "audit_action" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "installments_status_due" ON "installments" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "notifications_pending" ON "notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payments_status" ON "payments" USING btree ("status","succeeded_at");
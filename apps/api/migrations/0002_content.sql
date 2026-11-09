CREATE TABLE "faq_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"question_ar" text NOT NULL,
	"answer_ar" text NOT NULL,
	"question_en" text NOT NULL,
	"answer_en" text NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "admin_note" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "updated_at" timestamp with time zone;
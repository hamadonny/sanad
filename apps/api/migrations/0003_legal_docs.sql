CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"contract_version" integer,
	"title" text NOT NULL,
	"reviewer" text,
	"reviewed_on" date,
	"status" text NOT NULL,
	"notes" text,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_signatures" ADD COLUMN "pdf_key" text;--> statement-breakpoint
ALTER TABLE "contract_signatures" ADD COLUMN "pdf_sha256" text;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN "purpose" text DEFAULT 'LOGIN' NOT NULL;
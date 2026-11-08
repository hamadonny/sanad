CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_encrypted" text NOT NULL,
	"roles" text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auction_bids" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"spot" smallint NOT NULL,
	"amount_fils" bigint NOT NULL,
	"active" boolean NOT NULL,
	"placed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"details" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "circle_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "circle_members" (
	"circle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"spot" smallint,
	"original_spot" smallint,
	"tier_at_join" smallint NOT NULL,
	"holdback_bps" integer DEFAULT 0 NOT NULL,
	"bid_fils" bigint DEFAULT 0 NOT NULL,
	"is_replacement" boolean DEFAULT false NOT NULL,
	"received_payout" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "circle_members_circle_id_user_id_pk" PRIMARY KEY("circle_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "circles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text NOT NULL,
	"monthly_fils" bigint NOT NULL,
	"members" smallint NOT NULL,
	"config_version" integer NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"engine_state" jsonb NOT NULL,
	"commitment" text,
	"seed_encrypted" text,
	"forming_deadline" timestamp with time zone NOT NULL,
	"auction_ends_at" timestamp with time zone,
	"drawn_at" timestamp with time zone,
	"start_date" date,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_versions" (
	"version" integer PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"diff" jsonb,
	"notes" text,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"contract_version" integer,
	"circle_id" uuid,
	"document_hash" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"device_id" text,
	"otp_reference" text,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"version" integer PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'MEMBERSHIP' NOT NULL,
	"title_ar" text NOT NULL,
	"title_en" text NOT NULL,
	"body_ar" text NOT NULL,
	"body_en" text NOT NULL,
	"sha256" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "defaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"push_token" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_push_token_unique" UNIQUE("push_token")
);
--> statement-breakpoint
CREATE TABLE "draws" (
	"circle_id" uuid PRIMARY KEY NOT NULL,
	"algorithm_version" smallint NOT NULL,
	"commitment" text NOT NULL,
	"revealed_seed" text NOT NULL,
	"result" jsonb NOT NULL,
	"drawn_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installments" (
	"circle_id" uuid NOT NULL,
	"spot" smallint NOT NULL,
	"month" smallint NOT NULL,
	"user_id" uuid,
	"amount_fils" bigint NOT NULL,
	"due_date" date NOT NULL,
	"payout_date" date NOT NULL,
	"defaults_on" date NOT NULL,
	"status" text NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "installments_circle_id_spot_month_pk" PRIMARY KEY("circle_id","spot","month")
);
--> statement-breakpoint
CREATE TABLE "kyc_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"full_name_ar" text NOT NULL,
	"full_name_en" text NOT NULL,
	"civil_id_encrypted" text NOT NULL,
	"civil_id_hash" text NOT NULL,
	"nationality" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"civil_id_expiry" date NOT NULL,
	"address" text NOT NULL,
	"employer" text,
	"income_band" text,
	"front_doc_key" text,
	"back_doc_key" text,
	"selfie_key" text,
	"reviewer_id" uuid,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"side" text NOT NULL,
	"normal" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transaction_key" text NOT NULL,
	"account" text NOT NULL,
	"amount_fils" bigint NOT NULL,
	"circle_id" uuid,
	"member_id" uuid
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"circle_id" uuid,
	"member_id" uuid,
	"month" smallint,
	"memo" text,
	"reverses" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_transactions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "legal_case_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"amount_fils" bigint,
	"actor_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"gross_owed_fils" bigint NOT NULL,
	"holdback_applied_fils" bigint NOT NULL,
	"net_claim_fils" bigint NOT NULL,
	"recovered_fils" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"key" text NOT NULL,
	"language" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"channels" text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_templates_key_language_pk" PRIMARY KEY("key","language")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"channels" text[] NOT NULL,
	"data" jsonb,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"circle_id" uuid,
	"month" smallint,
	"spot" smallint,
	"monthly_fils" bigint NOT NULL,
	"amount_fils" bigint NOT NULL,
	"penalty_fils" bigint DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"idempotency_key" text NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"succeeded_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	CONSTRAINT "payments_provider_ref_unique" UNIQUE("provider_ref"),
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"month" smallint,
	"amount_fils" bigint NOT NULL,
	"status" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"provider_ref" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "payouts_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payment_id" uuid,
	"amount_fils" bigint NOT NULL,
	"status" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"provider_ref" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "refunds_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"completed_circles" integer DEFAULT 0 NOT NULL,
	"late_payments" integer DEFAULT 0 NOT NULL,
	"defaults" integer DEFAULT 0 NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"language" text DEFAULT 'ar' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"kyc_status" text DEFAULT 'NONE' NOT NULL,
	"full_name_ar" text,
	"full_name_en" text,
	"civil_id_hash" text,
	"civil_id_expiry" date,
	"banned_reason" text,
	"banned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_civil_id_hash_unique" UNIQUE("civil_id_hash")
);
--> statement-breakpoint
ALTER TABLE "auction_bids" ADD CONSTRAINT "auction_bids_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_bids" ADD CONSTRAINT "auction_bids_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_events" ADD CONSTRAINT "circle_events_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_members" ADD CONSTRAINT "circle_members_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_members" ADD CONSTRAINT "circle_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circles" ADD CONSTRAINT "circles_config_version_config_versions_version_fk" FOREIGN KEY ("config_version") REFERENCES "public"."config_versions"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defaults" ADD CONSTRAINT "defaults_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defaults" ADD CONSTRAINT "defaults_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draws" ADD CONSTRAINT "draws_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_key_ledger_transactions_key_fk" FOREIGN KEY ("transaction_key") REFERENCES "public"."ledger_transactions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_ledger_accounts_id_fk" FOREIGN KEY ("account") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_case_events" ADD CONSTRAINT "legal_case_events_case_id_legal_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."legal_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_cases" ADD CONSTRAINT "legal_cases_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_cases" ADD CONSTRAINT "legal_cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_profiles" ADD CONSTRAINT "trust_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auction_bids_seq" ON "auction_bids" USING btree ("circle_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "auction_bids_one_active" ON "auction_bids" USING btree ("circle_id","user_id") WHERE "auction_bids"."active";--> statement-breakpoint
CREATE INDEX "audit_created" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "circle_events_seq" ON "circle_events" USING btree ("circle_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "circle_members_spot" ON "circle_members" USING btree ("circle_id","spot");--> statement-breakpoint
CREATE INDEX "circle_members_user" ON "circle_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "circles_status_idx" ON "circles" USING btree ("status","monthly_fils");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_unique" ON "contract_signatures" USING btree ("user_id","kind","contract_version","circle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "defaults_unique" ON "defaults" USING btree ("circle_id","user_id");--> statement-breakpoint
CREATE INDEX "installments_user" ON "installments" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX "kyc_status_idx" ON "kyc_verifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_account" ON "ledger_entries" USING btree ("account");--> statement-breakpoint
CREATE INDEX "ledger_entries_circle" ON "ledger_entries" USING btree ("circle_id");--> statement-breakpoint
CREATE INDEX "ledger_tx_circle" ON "ledger_transactions" USING btree ("circle_id");--> statement-breakpoint
CREATE INDEX "ledger_tx_type" ON "ledger_transactions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "notifications_user" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "otp_phone_idx" ON "otp_challenges" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "payments_user" ON "payments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "payouts_status" ON "payouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "refresh_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refunds_status" ON "refunds" USING btree ("status");
CREATE TYPE "public"."membership" AS ENUM('active', 'suspended', 'free_trial');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'stopped', 'expired');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('pending', 'paid', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."invoice_type" AS ENUM('payment', 'credit');--> statement-breakpoint
CREATE TYPE "public"."chat_sender" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('new_license', 'renewal', 'upgrade', 'minutes_added');--> statement-breakpoint
CREATE TABLE "decart_api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"api_key" text NOT NULL,
	"api_secret" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"max_users" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	"assigned_license_key" varchar(64),
	"assignment_status" text DEFAULT 'available',
	"usage_load" integer DEFAULT 0,
	"health_status" text DEFAULT 'healthy',
	"total_credits_loaded" integer DEFAULT 0 NOT NULL,
	"credits_baseline" integer DEFAULT 0 NOT NULL,
	"threshold_pct" integer DEFAULT 15 NOT NULL,
	"last_topup_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "decart_credit_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"global_threshold_pct" integer DEFAULT 15 NOT NULL,
	"use_global_threshold" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"membership" "membership" DEFAULT 'free_trial' NOT NULL,
	"free_seconds_remaining" integer DEFAULT 0 NOT NULL,
	"total_minutes_purchased" integer DEFAULT 0 NOT NULL,
	"total_seconds_used" integer DEFAULT 0 NOT NULL,
	"is_admin" integer DEFAULT 0 NOT NULL,
	"is_sub_admin" integer DEFAULT 0 NOT NULL,
	"sub_admin_minutes_balance" integer DEFAULT 0 NOT NULL,
	"created_by_sub_admin" integer DEFAULT 0 NOT NULL,
	"created_by_sub_admin_id" integer,
	"decart_key_id" integer,
	"avatar_url" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"verification_pin" text,
	"verification_pin_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "license_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"device_id" varchar(128),
	"is_active" boolean DEFAULT true NOT NULL,
	"activated_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"minutes_allocated" real DEFAULT 0 NOT NULL,
	"used_seconds" integer DEFAULT 0 NOT NULL,
	"credits_allocated" integer DEFAULT 0 NOT NULL,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"streaming_enabled" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"last_session_at" timestamp,
	"assigned_decart_key_id" integer,
	"created_by_sub_admin_id" integer,
	"minutes_credited" boolean DEFAULT false NOT NULL,
	CONSTRAINT "license_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer,
	"license_key_id" integer,
	"decart_key_id" integer,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"stopped_at" timestamp,
	"duration_seconds" integer,
	"style" text,
	"package_label" text,
	"last_heartbeat_at" timestamp,
	"billing_started_at" timestamp,
	"last_deducted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"minutes" integer NOT NULL,
	"amount_usd" numeric(10, 2),
	"amount_usdt" numeric(10, 2) NOT NULL,
	"status" "invoice_status" DEFAULT 'pending' NOT NULL,
	"type" "invoice_type" DEFAULT 'payment' NOT NULL,
	"wallet_address" text NOT NULL,
	"wallet_network" text,
	"tx_hash" text,
	"note" text,
	"credited_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pricing" (
	"id" serial PRIMARY KEY NOT NULL,
	"minutes" integer NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"price_usd" numeric(10, 2) DEFAULT '0' NOT NULL,
	"price_usdt" numeric(10, 2) NOT NULL,
	"price_ghs" numeric(10, 2) DEFAULT '0' NOT NULL,
	"label" text NOT NULL,
	"plan_type" text DEFAULT 'topup' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"api_cost_per_minute_usd" numeric(10, 4) DEFAULT '1.20' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "device_fingerprints" (
	"id" serial PRIMARY KEY NOT NULL,
	"fingerprint_hash" text NOT NULL,
	"ip_hash" text DEFAULT '' NOT NULL,
	"ip_address" text NOT NULL,
	"user_agent" text NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "device_fingerprints_fingerprint_hash_unique" UNIQUE("fingerprint_hash")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"sender" "chat_sender" NOT NULL,
	"message" text NOT NULL,
	"read_by_admin" integer DEFAULT 0 NOT NULL,
	"read_by_user" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sub_admin_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"sub_admin_id" integer NOT NULL,
	"action" text NOT NULL,
	"target_user_id" integer,
	"minutes_amount" integer,
	"note" text,
	"performed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sub_admin_pricing" (
	"id" serial PRIMARY KEY NOT NULL,
	"minutes" integer NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"price_usd" numeric(10, 2) DEFAULT '0' NOT NULL,
	"price_usdt" numeric(10, 2) NOT NULL,
	"price_ghs" numeric(10, 2) DEFAULT '0' NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"plan_type" text DEFAULT 'topup' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_key" varchar(64) NOT NULL,
	"transaction_type" "transaction_type" DEFAULT 'new_license' NOT NULL,
	"pricing_id" integer,
	"package_label" text NOT NULL,
	"minutes_allocated" integer DEFAULT 0 NOT NULL,
	"duration_days" integer,
	"revenue_usd" numeric(10, 2) DEFAULT '0' NOT NULL,
	"revenue_ghs" numeric(10, 2) DEFAULT '0' NOT NULL,
	"api_cost_per_minute_usd" numeric(10, 4) DEFAULT '1.20' NOT NULL,
	"api_cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"profit_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"is_loss" boolean DEFAULT false NOT NULL,
	"exchange_rate_ghs_per_usd" numeric(10, 4) DEFAULT '1',
	"notes" text,
	"created_by_admin_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_rate_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"previous_rate" integer NOT NULL,
	"new_rate" integer NOT NULL,
	"changed_by" integer,
	"changed_by_email" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_accounting_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"license_key" text,
	"license_key_id" integer,
	"decart_key_id" integer,
	"started_at" timestamp,
	"stopped_at" timestamp,
	"billing_started_at" timestamp,
	"compute_seconds" integer,
	"billing_seconds" integer,
	"actual_api_credits" integer,
	"retail_seconds" integer,
	"retail_credits_charged" integer,
	"billing_rate_at_settle" real,
	"effective_credits_per_sec" real,
	"profit_margin_credits" integer,
	"settlement_source" text,
	"session_close_reason" text,
	"heartbeat_deductions_total" integer,
	"final_settlement_total" integer,
	"is_ghost_session" boolean DEFAULT false,
	"anomaly_flag" text,
	"stream_group_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "stream_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"stream_group_id" text NOT NULL,
	"license_key" text,
	"license_key_id" integer,
	"session_ids" text DEFAULT '[]' NOT NULL,
	"total_sessions" integer DEFAULT 0,
	"fragmentation_count" integer DEFAULT 0,
	"stream_start_time" timestamp,
	"stream_end_time" timestamp,
	"total_compute_seconds" integer DEFAULT 0,
	"total_billing_seconds" integer DEFAULT 0,
	"total_api_credits_used" integer DEFAULT 0,
	"total_retail_seconds" integer DEFAULT 0,
	"total_retail_credits_charged" integer DEFAULT 0,
	"profit_in_credits" integer DEFAULT 0,
	"effective_credits_per_second" real,
	"billing_rate_history" text DEFAULT '[]',
	"last_billing_rate_used" real,
	"is_active" boolean DEFAULT false,
	"computed_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "stream_ledger_stream_group_id_unique" UNIQUE("stream_group_id")
);
--> statement-breakpoint
CREATE TABLE "license_wallet" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_key" text NOT NULL,
	"license_key_id" integer NOT NULL,
	"allocated_seconds" integer DEFAULT 0,
	"used_seconds" integer DEFAULT 0,
	"remaining_seconds" integer DEFAULT 0,
	"status" text DEFAULT 'active',
	"billing_rate_snapshot" real,
	"active_session_count" integer DEFAULT 0,
	"total_session_count" integer DEFAULT 0,
	"reconnect_count" integer DEFAULT 0,
	"last_deduction_at" timestamp,
	"wallet_consistency_status" text DEFAULT 'unknown',
	"consistency_delta_seconds" integer DEFAULT 0,
	"snapshot_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "license_wallet_license_key_id_unique" UNIQUE("license_key_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_decart_key_id_decart_api_keys_id_fk" FOREIGN KEY ("decart_key_id") REFERENCES "public"."decart_api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_license_key_id_license_keys_id_fk" FOREIGN KEY ("license_key_id") REFERENCES "public"."license_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_decart_key_id_decart_api_keys_id_fk" FOREIGN KEY ("decart_key_id") REFERENCES "public"."decart_api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_fp_ip_hash_idx" ON "device_fingerprints" USING btree ("ip_hash");

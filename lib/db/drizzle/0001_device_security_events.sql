CREATE TABLE "device_security_events" (
"id" serial PRIMARY KEY NOT NULL,
"license_key" text NOT NULL,
"event_type" text NOT NULL,
"attempted_device_id" text NOT NULL,
"bound_device_id" text,
"ip_address" text,
"user_agent" text,
"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dse_license_key_idx" ON "device_security_events" USING btree ("license_key");
--> statement-breakpoint
CREATE INDEX "dse_event_type_idx" ON "device_security_events" USING btree ("event_type");
--> statement-breakpoint
CREATE INDEX "dse_created_at_idx" ON "device_security_events" USING btree ("created_at");

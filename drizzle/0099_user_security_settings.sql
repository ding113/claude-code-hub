CREATE TABLE IF NOT EXISTS "user_security_settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "subject_id" varchar(128) NOT NULL,
  "totp_enabled" boolean DEFAULT false NOT NULL,
  "totp_secret" text,
  "totp_secret_key_version" integer,
  "totp_last_used_counter" integer,
  "totp_pending_secret" text,
  "totp_pending_secret_key_version" integer,
  "totp_pending_expires_at" timestamp with time zone,
  "totp_bound_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_user_security_settings_subject_id"
  ON "user_security_settings" ("subject_id");

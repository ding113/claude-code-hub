-- Global streaming idle timeout for stuck-stream watchdog (ms). 0 = disabled.
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "streaming_idle_timeout_ms" integer NOT NULL DEFAULT 0;

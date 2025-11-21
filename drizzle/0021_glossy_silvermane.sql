ALTER TABLE "providers" ADD COLUMN "mcp_passthrough_type" varchar(20) DEFAULT 'none' NOT NULL;
ALTER TABLE "providers" ADD COLUMN "mcp_passthrough_url" varchar(512);
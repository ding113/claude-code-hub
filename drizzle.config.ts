import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load environment variables following Next.js priority order
// Priority: .env.development.local > .env.local > .env.development > .env
const envFiles = [".env.development.local", ".env.local", ".env.development", ".env"];
for (const envFile of envFiles) {
  config({ path: envFile });
}

export default defineConfig({
  out: "./drizzle",
  schema: "./src/drizzle/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DSN!,
  },
});

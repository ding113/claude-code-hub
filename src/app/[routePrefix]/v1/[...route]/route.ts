import "@/lib/polyfills/file";
import { handle } from "hono/vercel";
import { createV1App } from "@/app/v1/_lib/create-v1-app";

export const runtime = "nodejs";

const app = createV1App("/:routePrefix/v1");

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);
export const OPTIONS = handle(app);
export const HEAD = handle(app);

import "@/lib/polyfills/file";
import { Hono } from "hono";
import { handle } from "hono/vercel";
import { registerCors } from "@/app/v1/_lib/cors";
import { handleProxyRequest } from "@/app/v1/_lib/proxy-handler";
import { withDataDbScope } from "@/drizzle/db";

export const runtime = "nodejs";

const app = new Hono().basePath("/v2");

registerCors(app);
app.all("*", handleProxyRequest);

const routeHandler = withDataDbScope(handle(app));

export {
  routeHandler as GET,
  routeHandler as POST,
  routeHandler as DELETE,
  routeHandler as OPTIONS,
  routeHandler as HEAD,
};

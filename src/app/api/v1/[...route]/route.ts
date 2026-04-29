import "@/lib/auth-session-storage.node";
import { handle } from "hono/vercel";
import { withManagementSecurityHeaders } from "@/lib/api/v1/_shared/management-security-headers";
import { app } from "../_root/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const v1Handler = handle(app);

async function handleV1Request(request: Request): Promise<Response> {
  return withManagementSecurityHeaders(await v1Handler(request));
}

export const GET = handleV1Request;
export const POST = handleV1Request;
export const PUT = handleV1Request;
export const PATCH = handleV1Request;
export const DELETE = handleV1Request;
export const OPTIONS = handleV1Request;

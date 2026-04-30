import "@/lib/polyfills/file";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { withNoStoreHeaders } from "@/lib/api/v1/_shared/cache-control";
import { API_VERSION_HEADER, MANAGEMENT_API_VERSION } from "@/lib/api/v1/_shared/constants";
import { createProblemResponse, fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { jsonResponse } from "@/lib/api/v1/_shared/response-helpers";
import { adminUserInsightsRouter } from "../resources/admin-user-insights/router";
import { auditLogsRouter } from "../resources/audit-logs/router";
import { dashboardRouter } from "../resources/dashboard/router";
import { errorRulesRouter } from "../resources/error-rules/router";
import { keysRouter } from "../resources/keys/router";
import { meRouter } from "../resources/me/router";
import { modelPricesRouter } from "../resources/model-prices/router";
import { notificationsRouter } from "../resources/notifications/router";
import { providerEndpointsRouter } from "../resources/provider-endpoints/router";
import { providerGroupsRouter } from "../resources/provider-groups/router";
import { providersRouter } from "../resources/providers/router";
import { publicRouter } from "../resources/public/router";
import { requestFiltersRouter } from "../resources/request-filters/router";
import { sensitiveWordsRouter } from "../resources/sensitive-words/router";
import { sessionsRouter } from "../resources/sessions/router";
import { systemRouter } from "../resources/system/router";
import { usageLogsRouter } from "../resources/usage-logs/router";
import { usersRouter } from "../resources/users/router";
import { webhookTargetsRouter } from "../resources/webhook-targets/router";
import { registerDocs } from "./docs";

export const app = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return fromZodError(result.error, new URL(c.req.url).pathname);
    }
  },
}).basePath("/api/v1");

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "API Key or session token",
  description: "Authorization: Bearer <token>.",
});

app.openAPIRegistry.registerComponent("securitySchemes", "apiKeyAuth", {
  type: "apiKey",
  in: "header",
  name: "X-Api-Key",
  description: "User API key for read endpoints and optional admin access.",
});

app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
  type: "apiKey",
  in: "cookie",
  name: "auth-token",
  description: "Browser session cookie.",
});

app.use("*", async (c, next) => {
  await next();
  c.header(API_VERSION_HEADER, MANAGEMENT_API_VERSION);
});

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  summary: "Management API health",
  description: "Returns a lightweight health response for the REST management API shell.",
  "x-required-access": "public",
  responses: {
    200: {
      description: "The management API route shell is reachable.",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("ok"),
            apiVersion: z.literal(MANAGEMENT_API_VERSION),
          }),
        },
      },
    },
  },
});

app.openapi(healthRoute, (c) => {
  c.header(API_VERSION_HEADER, MANAGEMENT_API_VERSION);
  return c.json({
    status: "ok",
    apiVersion: MANAGEMENT_API_VERSION,
  });
});

const csrfRoute = createRoute({
  method: "get",
  path: "/auth/csrf",
  tags: ["Auth"],
  summary: "Issue CSRF token",
  description: "Returns a CSRF token for cookie-authenticated management API mutations.",
  "x-required-access": "read",
  security: [{ cookieAuth: [] }, { bearerAuth: [] }, { apiKeyAuth: [] }],
  responses: {
    200: {
      description: "CSRF token response.",
      content: {
        "application/json": {
          schema: z.object({
            csrfToken: z.string(),
          }),
        },
      },
    },
  },
});

app.openapi(csrfRoute, async (c) => {
  const { resolveAuth } = await import("@/lib/api/v1/_shared/auth-middleware");
  const { createCsrfToken } = await import("@/lib/api/v1/_shared/csrf");
  const auth = await resolveAuth(c, "read");
  if (auth instanceof Response) {
    withNoStoreHeaders(auth.headers);
    return auth;
  }
  if (!auth.token || !auth.session) {
    return createProblemResponse({
      status: 401,
      instance: new URL(c.req.url).pathname,
      errorCode: "auth.invalid",
      detail: "Authentication is invalid or expired.",
    });
  }

  return jsonResponse(
    {
      csrfToken: createCsrfToken({ authToken: auth.token, userId: auth.session.user.id }),
    },
    { headers: withNoStoreHeaders() }
  );
});

app.route("/", webhookTargetsRouter);
app.route("/", providersRouter);
app.route("/", notificationsRouter);
app.route("/", systemRouter);
app.route("/", sensitiveWordsRouter);
app.route("/", errorRulesRouter);
app.route("/", requestFiltersRouter);
app.route("/", publicRouter);
app.route("/", providerGroupsRouter);
app.route("/", adminUserInsightsRouter);
app.route("/", auditLogsRouter);
app.route("/", modelPricesRouter);
app.route("/", dashboardRouter);
app.route("/", sessionsRouter);
app.route("/", providerEndpointsRouter);
app.route("/", usersRouter);
app.route("/", keysRouter);
app.route("/", usageLogsRouter);
app.route("/", meRouter);

registerDocs(app);

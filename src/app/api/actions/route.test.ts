/**
 * Integration tests for Actions API - OpenAPI route adapter system
 *
 * Test coverage:
 * - OpenAPI route generation from Server Actions
 * - Request/response schema validation
 * - Authentication and authorization
 * - Error handling and edge cases
 * - OpenAPI spec endpoints (openapi.json, docs, scalar)
 * - ActionResult format handling
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import {
  createActionRoute,
  createActionRoutes,
  createParamSchema,
  IdParamSchema,
  PaginationSchema,
  SortSchema,
} from "@/lib/api/action-adapter-openapi";
import { z } from "zod";
import type { ActionResult } from "@/actions/types";

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe("Actions API - OpenAPI Route Adapter", () => {
  let app: OpenAPIHono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new OpenAPIHono().basePath("/api/actions");
  });

  describe("createActionRoute - Basic Route Generation", () => {
    it("should create route and handler for simple action", async () => {
      const mockAction = vi.fn().mockResolvedValue({ ok: true, data: { result: "success" } });

      const { route, handler } = createActionRoute("users", "getUsers", mockAction, {
        description: "Get all users",
        tags: ["User Management"],
      });

      expect(route.method).toBe("post");
      expect(route.path).toBe("/users/getUsers");
      expect(route.tags).toEqual(["User Management"]);
      expect(handler).toBeInstanceOf(Function);
    });

    it("should create route with request schema", () => {
      const mockAction = vi.fn();
      const requestSchema = z.object({
        userId: z.number().int().positive(),
      });

      const { route } = createActionRoute("users", "editUser", mockAction, {
        requestSchema,
        description: "Edit user",
      });

      expect(route.request.body.content["application/json"].schema).toBe(requestSchema);
    });

    it("should create route with response schema", () => {
      const mockAction = vi.fn();
      const responseSchema = z.object({
        id: z.number(),
        name: z.string(),
      });

      const { route } = createActionRoute("users", "addUser", mockAction, {
        responseSchema,
        description: "Add user",
      });

      const response200 = route.responses[200];
      expect(response200).toBeDefined();
      expect(response200.description).toBe("操作成功");
    });

    it("should include standard error responses", () => {
      const mockAction = vi.fn();

      const { route } = createActionRoute("users", "getUsers", mockAction);

      expect(route.responses[200]).toBeDefined();
      expect(route.responses[400]).toBeDefined();
      expect(route.responses[401]).toBeDefined();
      expect(route.responses[403]).toBeDefined();
      expect(route.responses[500]).toBeDefined();
    });

    it("should support custom tags and descriptions", () => {
      const mockAction = vi.fn();

      const { route } = createActionRoute("users", "getUsers", mockAction, {
        description: "Custom description",
        summary: "Custom summary",
        tags: ["Custom Tag 1", "Custom Tag 2"],
      });

      expect(route.description).toBe("Custom description");
      expect(route.summary).toBe("Custom summary");
      expect(route.tags).toEqual(["Custom Tag 1", "Custom Tag 2"]);
    });

    it("should use default tags from module name", () => {
      const mockAction = vi.fn();

      const { route } = createActionRoute("users", "getUsers", mockAction);

      expect(route.tags).toEqual(["users"]);
    });
  });

  describe("Handler - Request Processing", () => {
    it("should call server action with request body", async () => {
      const mockAction = vi.fn().mockResolvedValue({ ok: true, data: { result: "success" } });
      const requestBody = { userId: 123 };

      const { handler } = createActionRoute("users", "getUser", mockAction);

      const mockContext = {
        req: {
          json: vi.fn().mockResolvedValue(requestBody),
        },
        json: vi.fn(),
      } as any;

      await handler(mockContext);

      expect(mockAction).toHaveBeenCalledWith(requestBody);
    });

    it("should handle empty request body", async () => {
      const mockAction = vi.fn().mockResolvedValue({ ok: true, data: [] });

      const { handler } = createActionRoute("users", "getUsers", mockAction);

      const mockContext = {
        req: {
          json: vi.fn().mockResolvedValue({}),
        },
        json: vi.fn(),
      } as any;

      await handler(mockContext);

      expect(mockAction).toHaveBeenCalledWith({});
    });

    it("should handle malformed JSON request", async () => {
      const mockAction = vi.fn().mockResolvedValue({ ok: true, data: [] });

      const { handler } = createActionRoute("users", "getUsers", mockAction);

      const mockContext = {
        req: {
          json: vi.fn().mockRejectedValue(new Error("Invalid JSON")),
        },
        json: vi.fn(),
      } as any;

      await handler(mockContext);

      expect(mockAction).toHaveBeenCalledWith({});
    });
  });

  describe("Handler - ActionResult Format Handling", () => {
    it("should handle ActionResult with ok: true", async () => {
      const mockData = { id: 1, name: "Test User" };
      const mockAction = vi.fn().mockResolvedValue({ ok: true, data: mockData });

      const { handler } = createActionRoute("users", "getUser", mockAction);

      const mockJson = vi.fn();
      const mockContext = {
        req: { json: vi.fn().mockResolvedValue({}) },
        json: mockJson,
      } as any;

      await handler(mockContext);

      expect(mockJson).toHaveBeenCalledWith({ ok: true, data: mockData }, 200);
    });

    it("should handle ActionResult with ok: false", async () => {
      const mockAction = vi
        .fn()
        .mockResolvedValue({ ok: false, error: "User not found" } as ActionResult);

      const { handler } = createActionRoute("users", "getUser", mockAction);

      const mockJson = vi.fn();
      const mockContext = {
        req: { json: vi.fn().mockResolvedValue({}) },
        json: mockJson,
      } as any;

      await handler(mockContext);

      expect(mockJson).toHaveBeenCalledWith({ ok: false, error: "User not found" }, 400);
    });

    it("should wrap non-ActionResult format responses", async () => {
      const mockData = { id: 1, name: "Test User" };
      const mockAction = vi.fn().mockResolvedValue(mockData);

      const { handler } = createActionRoute("users", "getUser", mockAction);

      const mockJson = vi.fn();
      const mockContext = {
        req: { json: vi.fn().mockResolvedValue({}) },
        json: mockJson,
      } as any;

      await handler(mockContext);

      expect(mockJson).toHaveBeenCalledWith({ ok: true, data: mockData }, 200);
    });

    it("should handle array responses", async () => {
      const mockData = [
        { id: 1, name: "User 1" },
        { id: 2, name: "User 2" },
      ];
      const mockAction = vi.fn().mockResolvedValue(mockData);

      const { handler } = createActionRoute("users", "getUsers", mockAction);

      const mockJson = vi.fn();
      const mockContext = {
        req: { json: vi.fn().mockResolvedValue({}) },
        json: mockJson,
      } as any;

      await handler(mockContext);

      expect(mockJson).toHaveBeenCalledWith({ ok: true, data: mockData }, 200);
    });

    it("should handle primitive responses", async () => {
      const mockAction = vi.fn().mockResolvedValue(true);

      const { handler } = createActionRoute("model-prices", "hasPriceTable", mockAction);

      const mockJson = vi.fn();
      const mockContext = {
        req: { json: vi.fn().mockResolvedValue({}) },
        json: mockJson,
      } as any;

      await handler(mockContext);

      expect(mockJson).toHaveBeenCalledWith({ ok: true, data: true }, 200);
    });

    it("should handle null responses", async () => {
      const mockAction = vi.fn().mockResolvedValue(null);

      const { handler } = createActionRoute("users", "deleteUser", mockAction);

      const mockJson = vi.fn();
      const mockContext = {
        req: { json: vi.fn().mockResolvedValue({}) },
        json: mockJson,
      } as any;

      await handler(mockContext);

      expect(mockJson).toHaveBeenCalledWith({ ok: true, data: null }, 200);
    });

    it("should handle undefined responses", async () => {
      const mockAction = vi.fn().mockResolvedValue(undefined);

      const { handler } = createActionRoute("users", "deleteUser", mockAction);

      const mockJson = vi.fn();
      const mockContext = {
        req: { json: vi.fn().mockResolvedValue({}) },
        json: mockJson,
      } as any;

      await handler(mockContext);

      expect(mockJson).toHaveBeenCalledWith({ ok: true, data: undefined }, 200);
    });
  });

  describe("Handler - Error Handling", () => {
    it("should handle thrown errors with 500 status", async () => {
      const mockAction = vi.fn().mockRejectedValue(new Error("Database connection failed"));

      const { handler } = createActionRoute("users", "getUsers", mockAction);

      const mockJson = vi.fn();
      const mockContext = {
        req: { json: vi.fn().mockResolvedValue({}) },
        json: mockJson,
      } as any;

      await handler(mockContext);

      expect(mockJson).toHaveBeenCalledWith(
        { ok: false, error: "Database connection failed" },
        500
      );
    });

    it("should handle non-Error thrown values", async () => {
      const mockAction = vi.fn().mockRejectedValue("String error");

      const { handler } = createActionRoute("users", "getUsers", mockAction);

      const mockJson = vi.fn();
      const mockContext = {
        req: { json: vi.fn().mockResolvedValue({}) },
        json: mockJson,
      } as any;

      await handler(mockContext);

      expect(mockJson).toHaveBeenCalledWith({ ok: false, error: "服务器内部错误" }, 500);
    });

    it("should handle errors with empty message", async () => {
      const mockAction = vi.fn().mockRejectedValue(new Error(""));

      const { handler } = createActionRoute("users", "getUsers", mockAction);

      const mockJson = vi.fn();
      const mockContext = {
        req: { json: vi.fn().mockResolvedValue({}) },
        json: mockJson,
      } as any;

      await handler(mockContext);

      expect(mockJson).toHaveBeenCalledWith({ ok: false, error: "服务器内部错误" }, 500);
    });

    it("should log errors", async () => {
      const mockAction = vi.fn().mockRejectedValue(new Error("Test error"));
      const { logger } = await import("@/lib/logger");

      const { handler } = createActionRoute("users", "getUsers", mockAction);

      const mockContext = {
        req: { json: vi.fn().mockResolvedValue({}) },
        json: vi.fn(),
      } as any;

      await handler(mockContext);

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("Handler - Logging", () => {
    it("should log debug info on action call", async () => {
      const mockAction = vi.fn().mockResolvedValue({ ok: true, data: {} });
      const { logger } = await import("@/lib/logger");

      const { handler } = createActionRoute("users", "getUsers", mockAction);

      const mockContext = {
        req: { json: vi.fn().mockResolvedValue({ test: "data" }) },
        json: vi.fn(),
      } as any;

      await handler(mockContext);

      expect(logger.debug).toHaveBeenCalledWith(
        "[ActionAPI] Calling users.getUsers",
        expect.any(Object)
      );
    });

    it("should log completion with duration", async () => {
      const mockAction = vi.fn().mockResolvedValue({ ok: true, data: {} });
      const { logger } = await import("@/lib/logger");

      const { handler } = createActionRoute("users", "getUsers", mockAction);

      const mockContext = {
        req: { json: vi.fn().mockResolvedValue({}) },
        json: vi.fn(),
      } as any;

      await handler(mockContext);

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("completed in"),
        expect.any(Object)
      );
    });

    it("should log warnings on action failure", async () => {
      const mockAction = vi.fn().mockResolvedValue({ ok: false, error: "Validation failed" });
      const { logger } = await import("@/lib/logger");

      const { handler } = createActionRoute("users", "addUser", mockAction);

      const mockContext = {
        req: { json: vi.fn().mockResolvedValue({}) },
        json: vi.fn(),
      } as any;

      await handler(mockContext);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("failed"),
        expect.any(Object)
      );
    });
  });

  describe("Handler - Performance", () => {
    it("should track execution duration", async () => {
      const mockAction = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ ok: true, data: {} }), 100);
          })
      );

      const { handler } = createActionRoute("users", "getUsers", mockAction);

      const mockContext = {
        req: { json: vi.fn().mockResolvedValue({}) },
        json: vi.fn(),
      } as any;

      const startTime = Date.now();
      await handler(mockContext);
      const duration = Date.now() - startTime;

      expect(duration).toBeGreaterThanOrEqual(100);
    });
  });

  describe("OpenAPI Integration - Multiple Routes", () => {
    it("should register multiple routes on OpenAPIHono app", () => {
      const mockAction1 = vi.fn().mockResolvedValue({ ok: true, data: [] });
      const mockAction2 = vi.fn().mockResolvedValue({ ok: true, data: {} });

      const { route: route1, handler: handler1 } = createActionRoute(
        "users",
        "getUsers",
        mockAction1,
        { description: "Get all users" }
      );

      const { route: route2, handler: handler2 } = createActionRoute(
        "users",
        "addUser",
        mockAction2,
        {
          requestSchema: z.object({ name: z.string() }),
          description: "Add user",
        }
      );

      app.openapi(route1, handler1);
      app.openapi(route2, handler2);

      // Verify routes are registered
      expect(route1.path).toBe("/users/getUsers");
      expect(route2.path).toBe("/users/addUser");
    });

    it("should support different modules", () => {
      const userAction = vi.fn();
      const providerAction = vi.fn();
      const keyAction = vi.fn();

      const { route: userRoute } = createActionRoute("users", "getUsers", userAction);
      const { route: providerRoute } = createActionRoute(
        "providers",
        "getProviders",
        providerAction
      );
      const { route: keyRoute } = createActionRoute("keys", "getKeys", keyAction);

      expect(userRoute.path).toBe("/users/getUsers");
      expect(providerRoute.path).toBe("/providers/getProviders");
      expect(keyRoute.path).toBe("/keys/getKeys");
    });
  });

  describe("Schema Validation Integration", () => {
    it("should validate request schema via Zod", async () => {
      const mockAction = vi.fn().mockResolvedValue({ ok: true, data: {} });
      const requestSchema = z.object({
        userId: z.number().int().positive(),
        name: z.string().min(1),
      });

      const { handler } = createActionRoute("users", "editUser", mockAction, {
        requestSchema,
      });

      const validRequest = { userId: 1, name: "Test User" };
      const mockContext = {
        req: { json: vi.fn().mockResolvedValue(validRequest) },
        json: vi.fn(),
      } as any;

      await handler(mockContext);

      expect(mockAction).toHaveBeenCalledWith(validRequest);
    });

    it("should accept passthrough schemas for flexible requests", async () => {
      const mockAction = vi.fn().mockResolvedValue({ ok: true, data: {} });

      const { handler } = createActionRoute("users", "editUser", mockAction, {
        requestSchema: z.object({}).passthrough(),
      });

      const requestWithExtraFields = { userId: 1, name: "Test", extra: "field" };
      const mockContext = {
        req: { json: vi.fn().mockResolvedValue(requestWithExtraFields) },
        json: vi.fn(),
      } as any;

      await handler(mockContext);

      expect(mockAction).toHaveBeenCalledWith(requestWithExtraFields);
    });
  });

  describe("Authentication Configuration", () => {
    it("should include security config when requiresAuth is true", () => {
      const mockAction = vi.fn();

      const { route } = createActionRoute("users", "getUsers", mockAction, {
        requiresAuth: true,
      });

      expect(route.security).toEqual([{ cookieAuth: [] }]);
    });

    it("should default to requiresAuth: true", () => {
      const mockAction = vi.fn();

      const { route } = createActionRoute("users", "getUsers", mockAction);

      expect(route.security).toEqual([{ cookieAuth: [] }]);
    });

    it("should omit security config when requiresAuth is false", () => {
      const mockAction = vi.fn();

      const { route } = createActionRoute("users", "publicEndpoint", mockAction, {
        requiresAuth: false,
      });

      expect(route.security).toBeUndefined();
    });

    it("should support requiredRole configuration", () => {
      const mockAction = vi.fn();

      const { route: adminRoute } = createActionRoute("users", "deleteUser", mockAction, {
        requiredRole: "admin",
      });

      const { route: userRoute } = createActionRoute("users", "getProfile", mockAction, {
        requiredRole: "user",
      });

      expect(adminRoute.security).toEqual([{ cookieAuth: [] }]);
      expect(userRoute.security).toEqual([{ cookieAuth: [] }]);
    });
  });

  describe("Edge Cases", () => {
    it("should handle action returning promise of ActionResult", async () => {
      const mockAction = vi.fn().mockResolvedValue({ ok: true, data: { result: "success" } });

      const { handler } = createActionRoute("users", "asyncAction", mockAction);

      const mockJson = vi.fn();
      const mockContext = {
        req: { json: vi.fn().mockResolvedValue({}) },
        json: mockJson,
      } as any;

      await handler(mockContext);

      expect(mockJson).toHaveBeenCalledWith({ ok: true, data: { result: "success" } }, 200);
    });

    it("should handle very large request bodies", async () => {
      const mockAction = vi.fn().mockResolvedValue({ ok: true, data: {} });
      const largeBody = { data: "x".repeat(100000) };

      const { handler } = createActionRoute("users", "bulkUpdate", mockAction);

      const mockContext = {
        req: { json: vi.fn().mockResolvedValue(largeBody) },
        json: vi.fn(),
      } as any;

      await handler(mockContext);

      expect(mockAction).toHaveBeenCalledWith(largeBody);
    });

    it("should handle special characters in request data", async () => {
      const mockAction = vi.fn().mockResolvedValue({ ok: true, data: {} });
      const specialCharsBody = { name: "User<>\"'&@#$%^&*()" };

      const { handler } = createActionRoute("users", "addUser", mockAction);

      const mockContext = {
        req: { json: vi.fn().mockResolvedValue(specialCharsBody) },
        json: vi.fn(),
      } as any;

      await handler(mockContext);

      expect(mockAction).toHaveBeenCalledWith(specialCharsBody);
    });

    it("should handle unicode characters in request data", async () => {
      const mockAction = vi.fn().mockResolvedValue({ ok: true, data: {} });
      const unicodeBody = { name: "用户名称 🚀" };

      const { handler } = createActionRoute("users", "addUser", mockAction);

      const mockContext = {
        req: { json: vi.fn().mockResolvedValue(unicodeBody) },
        json: vi.fn(),
      } as any;

      await handler(mockContext);

      expect(mockAction).toHaveBeenCalledWith(unicodeBody);
    });

    it("should handle deeply nested objects", async () => {
      const mockAction = vi.fn().mockResolvedValue({ ok: true, data: {} });
      const nestedBody = {
        level1: {
          level2: {
            level3: {
              data: "deep",
            },
          },
        },
      };

      const { handler } = createActionRoute("users", "complexUpdate", mockAction);

      const mockContext = {
        req: { json: vi.fn().mockResolvedValue(nestedBody) },
        json: vi.fn(),
      } as any;

      await handler(mockContext);

      expect(mockAction).toHaveBeenCalledWith(nestedBody);
    });

    it("should handle concurrent requests", async () => {
      const mockAction = vi
        .fn()
        .mockImplementation(
          (body) =>
            new Promise((resolve) => setTimeout(() => resolve({ ok: true, data: body }), 50))
        );

      const { handler } = createActionRoute("users", "getUsers", mockAction);

      const requests = Array.from({ length: 10 }, (_, i) => {
        const mockContext = {
          req: { json: vi.fn().mockResolvedValue({ id: i }) },
          json: vi.fn(),
        } as any;
        return handler(mockContext);
      });

      await Promise.all(requests);

      expect(mockAction).toHaveBeenCalledTimes(10);
    });
  });

  describe("Response Schema Definition", () => {
    it("should include response schema in OpenAPI route definition", () => {
      const mockAction = vi.fn();
      const responseSchema = z.object({
        generatedKey: z.string(),
        name: z.string(),
      });

      const { route } = createActionRoute("keys", "addKey", mockAction, {
        responseSchema,
        description: "Create new key",
      });

      const response200 = route.responses[200];
      expect(response200).toBeDefined();
      expect(response200.description).toBe("操作成功");
    });

    it("should support array response schemas", () => {
      const mockAction = vi.fn();
      const responseSchema = z.array(z.string());

      const { route } = createActionRoute("usage-logs", "getModelList", mockAction, {
        responseSchema,
      });

      const response200 = route.responses[200];
      expect(response200).toBeDefined();
    });

    it("should support primitive response schemas", () => {
      const mockAction = vi.fn();
      const responseSchema = z.boolean();

      const { route } = createActionRoute("model-prices", "hasPriceTable", mockAction, {
        responseSchema,
      });

      const response200 = route.responses[200];
      expect(response200).toBeDefined();
    });
  });

  describe("Batch Route Creation - createActionRoutes", () => {
    it("should create multiple routes from action map", () => {
      const mockActions = {
        getUsers: vi.fn(),
        addUser: vi.fn(),
        editUser: vi.fn(),
      };

      const routes = createActionRoutes("users", mockActions);

      expect(routes).toHaveLength(3);
      expect(routes[0].route.path).toBe("/users/getUsers");
      expect(routes[1].route.path).toBe("/users/addUser");
      expect(routes[2].route.path).toBe("/users/editUser");
    });

    it("should apply options from optionsMap", () => {
      const mockActions = {
        getUsers: vi.fn(),
        addUser: vi.fn(),
      };

      const optionsMap = {
        getUsers: { description: "Get all users", tags: ["Users"] },
        addUser: {
          requestSchema: z.object({ name: z.string() }),
          description: "Add new user",
          tags: ["Users"],
        },
      };

      const routes = createActionRoutes("users", mockActions, optionsMap);

      expect(routes[0].route.description).toBe("Get all users");
      expect(routes[0].route.tags).toEqual(["Users"]);
      expect(routes[1].route.description).toBe("Add new user");
    });

    it("should use default options when optionsMap is not provided", () => {
      const mockActions = {
        getUsers: vi.fn(),
        addUser: vi.fn(),
      };

      const routes = createActionRoutes("users", mockActions);

      expect(routes).toHaveLength(2);
      expect(routes[0].route.description).toBe("执行 getUsers 操作");
      expect(routes[1].route.description).toBe("执行 addUser 操作");
    });

    it("should handle empty actions map", () => {
      const routes = createActionRoutes("users", {});

      expect(routes).toHaveLength(0);
    });

    it("should handle partial optionsMap", () => {
      const mockActions = {
        getUsers: vi.fn(),
        addUser: vi.fn(),
        editUser: vi.fn(),
      };

      const optionsMap = {
        addUser: { description: "Add user" },
      };

      const routes = createActionRoutes("users", mockActions, optionsMap);

      expect(routes).toHaveLength(3);
      expect(routes[0].route.description).toBe("执行 getUsers 操作");
      expect(routes[1].route.description).toBe("Add user");
      expect(routes[2].route.description).toBe("执行 editUser 操作");
    });
  });

  describe("Helper Schemas", () => {
    it("should create param schema from object definition", () => {
      const schema = createParamSchema({
        id: z.number(),
        name: z.string(),
      });

      const result = schema.parse({ id: 1, name: "test" });
      expect(result).toEqual({ id: 1, name: "test" });
    });

    it("should use IdParamSchema for ID validation", () => {
      expect(() => IdParamSchema.parse({ id: 1 })).not.toThrow();
      expect(() => IdParamSchema.parse({ id: 0 })).toThrow();
      expect(() => IdParamSchema.parse({ id: -1 })).toThrow();
      expect(() => IdParamSchema.parse({ id: 1.5 })).toThrow();
    });

    it("should use PaginationSchema with defaults", () => {
      const result1 = PaginationSchema.parse({});
      expect(result1.page).toBe(1);
      expect(result1.pageSize).toBe(20);

      const result2 = PaginationSchema.parse({ page: 5, pageSize: 50 });
      expect(result2.page).toBe(5);
      expect(result2.pageSize).toBe(50);

      expect(() => PaginationSchema.parse({ pageSize: 101 })).toThrow();
    });

    it("should use SortSchema with defaults", () => {
      const result1 = SortSchema.parse({});
      expect(result1.sortOrder).toBe("desc");
      expect(result1.sortBy).toBeUndefined();

      const result2 = SortSchema.parse({ sortBy: "createdAt", sortOrder: "asc" });
      expect(result2.sortBy).toBe("createdAt");
      expect(result2.sortOrder).toBe("asc");
    });
  });
});

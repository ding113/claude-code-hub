import { describe, expect, it } from "vitest";
import { appendPublicStatusOpenApi } from "@/lib/public-status/openapi";

describe("public-status OpenAPI helper", () => {
  it("preserves existing paths while appending public status paths", () => {
    const input = {
      paths: {
        "/api/actions/users/getUsers": {
          post: {
            summary: "getUsers",
          },
        },
      },
      tags: [
        {
          name: "用户管理",
          description: "users",
        },
      ],
    };

    const result = appendPublicStatusOpenApi(input);

    expect(result.paths["/api/actions/users/getUsers"]).toEqual(
      input.paths["/api/actions/users/getUsers"]
    );
    expect(result.paths["/api/public-status"]).toBeDefined();
    expect(result.paths["/api/public-site-meta"]).toBeDefined();
  });

  it("does not duplicate the public-status tag when it already exists", () => {
    const result = appendPublicStatusOpenApi({
      paths: {},
      tags: [
        {
          name: "公开状态",
          description: "already present",
        },
      ],
    });

    expect(result.tags?.filter((tag) => tag.name === "公开状态")).toHaveLength(1);
  });

  it("does not mutate the input document in place", () => {
    const input = {
      paths: {
        "/api/actions/users/getUsers": {
          post: {
            summary: "getUsers",
          },
        },
      },
      tags: [
        {
          name: "用户管理",
          description: "users",
        },
      ],
    };
    const snapshot = structuredClone(input);

    appendPublicStatusOpenApi(input);

    expect(input).toEqual(snapshot);
  });
});

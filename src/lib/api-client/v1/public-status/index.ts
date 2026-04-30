/**
 * /api/v1/public/status 类型化客户端方法
 */

import type { z } from "@hono/zod-openapi";
import type {
  PublicStatusResponseSchema,
  PublicStatusSettingsRequest,
  PublicStatusSettingsResponseSchema,
} from "@/lib/api/v1/schemas/public-status";
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

type PublicStatusResponse = z.infer<typeof PublicStatusResponseSchema>;
type PublicStatusSettingsResponse = z.infer<typeof PublicStatusSettingsResponseSchema>;

const BASE_PATH = "/api/v1/public/status";

export interface PublicStatusClient {
  get(): Promise<PublicStatusResponse>;
  updateSettings(input: PublicStatusSettingsRequest): Promise<PublicStatusSettingsResponse>;
}

async function get(): Promise<PublicStatusResponse> {
  const r = await fetchApi(BASE_PATH, { method: "GET" });
  return (await r.json()) as PublicStatusResponse;
}

async function updateSettings(
  input: PublicStatusSettingsRequest
): Promise<PublicStatusSettingsResponse> {
  const r = await fetchApi(`${BASE_PATH}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await r.json()) as PublicStatusSettingsResponse;
}

export const publicStatusClient: PublicStatusClient = {
  get,
  updateSettings,
};

Object.assign(apiClient, { publicStatus: publicStatusClient });

/**
 * /api/v1/system 类型化客户端方法
 */

import type {
  SystemSettingsResponse,
  SystemSettingsUpdateInput,
  SystemTimezoneResponse,
} from "@/lib/api/v1/schemas/system";
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

const BASE_PATH = "/api/v1/system";

export interface SystemClient {
  getSettings(): Promise<SystemSettingsResponse>;
  updateSettings(input: SystemSettingsUpdateInput): Promise<SystemSettingsResponse>;
  getTimezone(): Promise<SystemTimezoneResponse>;
}

async function getSettings(): Promise<SystemSettingsResponse> {
  const response = await fetchApi(`${BASE_PATH}/settings`, { method: "GET" });
  return (await response.json()) as SystemSettingsResponse;
}

async function updateSettings(input: SystemSettingsUpdateInput): Promise<SystemSettingsResponse> {
  const response = await fetchApi(`${BASE_PATH}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await response.json()) as SystemSettingsResponse;
}

async function getTimezone(): Promise<SystemTimezoneResponse> {
  const response = await fetchApi(`${BASE_PATH}/timezone`, { method: "GET" });
  return (await response.json()) as SystemTimezoneResponse;
}

export const systemClient: SystemClient = {
  getSettings,
  updateSettings,
  getTimezone,
};

Object.assign(apiClient, { system: systemClient });

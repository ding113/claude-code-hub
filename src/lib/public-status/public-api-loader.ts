import "server-only";

import { cache } from "react";
import type { PublicStatusPayload } from "@/lib/public-status/payload";
import {
  type PublicStatusRouteResponse,
  toPublicStatusPayload,
} from "@/lib/public-status/public-api-contract";
import { DEFAULT_SITE_TITLE } from "@/lib/site-title";

export interface PublicSiteMetaRouteResponse {
  available: boolean;
  siteTitle: string | null;
  siteDescription: string | null;
  timeZone: string | null;
  source: "projection";
  reason?: "projection_missing";
}

export interface LoadedPublicStatusPageData {
  initialPayload: PublicStatusPayload;
  status: PublicStatusRouteResponse["status"];
  intervalMinutes: number;
  rangeHours: number;
  followServerDefaults: boolean;
  siteTitle: string;
  timeZone: string;
  meta: PublicStatusRouteResponse["meta"];
  response: PublicStatusRouteResponse;
}

async function readPublicStatusRoute(params: URLSearchParams): Promise<PublicStatusRouteResponse> {
  const { GET } = await import("@/app/api/public-status/route");
  const url = new URL("http://localhost/api/public-status");
  const queryString = params.toString();
  if (queryString) {
    url.search = queryString;
  }

  const response = await GET(new Request(url, { headers: { Accept: "application/json" } }));

  const body = (await response.json()) as PublicStatusRouteResponse | { error: string };
  if (!response.ok && response.status === 400) {
    throw new Error(`PUBLIC_STATUS_INVALID_QUERY:${(body as { error: string }).error}`);
  }
  if (!response.ok && response.status !== 503) {
    throw new Error(`PUBLIC_STATUS_FETCH_FAILED:${response.status}`);
  }

  return body as PublicStatusRouteResponse;
}

async function readPublicSiteMetaRoute(): Promise<PublicSiteMetaRouteResponse> {
  const { GET } = await import("@/app/api/public-site-meta/route");
  const response = await GET();

  const body = (await response.json()) as PublicSiteMetaRouteResponse | { error: string };
  if (!response.ok) {
    throw new Error(`PUBLIC_SITE_META_FETCH_FAILED:${response.status}`);
  }

  return body as PublicSiteMetaRouteResponse;
}

const loadRootStatusResponse = cache(async () => {
  return await readPublicStatusRoute(new URLSearchParams());
});

const loadGroupStatusResponse = cache(async (groupSlug: string) => {
  const params = new URLSearchParams();
  params.set("groupSlug", groupSlug);
  return await readPublicStatusRoute(params);
});

const loadPublicSiteMetaResponse = cache(async () => {
  return await readPublicSiteMetaRoute();
});

export async function loadPublicStatusPageData(input?: {
  groupSlug?: string;
}): Promise<LoadedPublicStatusPageData> {
  const response = input?.groupSlug
    ? await loadGroupStatusResponse(input.groupSlug)
    : await loadRootStatusResponse();
  const initialPayload = toPublicStatusPayload(response);

  return {
    initialPayload,
    status: response.status,
    intervalMinutes: response.resolvedQuery.intervalMinutes,
    rangeHours: response.resolvedQuery.rangeHours,
    followServerDefaults: true,
    siteTitle: response.meta?.siteTitle?.trim() || DEFAULT_SITE_TITLE,
    timeZone: response.meta?.timeZone ?? "UTC",
    meta: response.meta,
    response,
  };
}

export async function loadPublicSiteMeta(): Promise<PublicSiteMetaRouteResponse> {
  return await loadPublicSiteMetaResponse();
}

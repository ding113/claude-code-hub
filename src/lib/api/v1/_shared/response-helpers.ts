import { API_VERSION_HEADER, MANAGEMENT_API_VERSION } from "./constants";
import { serializeDates } from "./serialization";

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set(API_VERSION_HEADER, MANAGEMENT_API_VERSION);
  return new Response(JSON.stringify(serializeDates(body)), {
    ...init,
    headers,
  });
}

export function createdResponse(
  body: unknown,
  location: string,
  init: ResponseInit = {}
): Response {
  const headers = new Headers(init.headers);
  headers.set("Location", location);
  return jsonResponse(body, {
    ...init,
    status: 201,
    headers,
  });
}

export function noContentResponse(init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set(API_VERSION_HEADER, MANAGEMENT_API_VERSION);
  return new Response(null, {
    ...init,
    status: 204,
    headers,
  });
}

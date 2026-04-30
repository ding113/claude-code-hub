import { DELETE, GET, OPTIONS, PATCH, POST, PUT } from "@/app/api/v1/[...route]/route";

export type V1RouteCallOptions = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
  pathname: string;
  authToken?: string;
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: BodyInit;
};

const handlers = {
  GET,
  POST,
  PUT,
  PATCH,
  DELETE,
  OPTIONS,
};

export async function callV1Route(options: V1RouteCallOptions): Promise<{
  response: Response;
  json?: unknown;
  text?: string;
}> {
  const url = new URL(options.pathname, "http://localhost");
  const headers: Record<string, string> = { ...(options.headers ?? {}) };

  if (options.authToken) {
    const existing = headers.Cookie ? `${headers.Cookie}; ` : "";
    headers.Cookie = `${existing}auth-token=${options.authToken}`;
    headers.Authorization = headers.Authorization ?? `Bearer ${options.authToken}`;
  }

  if (options.body !== undefined && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const request = new Request(url, {
    method: options.method,
    headers,
    body:
      options.rawBody !== undefined
        ? options.rawBody
        : options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
  });

  const response = await handlers[options.method](request);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    return { response, json: await response.json() };
  }

  return { response, text: await response.text() };
}

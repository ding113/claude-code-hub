export function attachSessionIdToErrorMessage(
  sessionId: string | null | undefined,
  message: string
): string {
  if (!sessionId) return message;
  if (message.includes("cch_session_id:")) return message;
  return `${message} (cch_session_id: ${sessionId})`;
}

export async function attachSessionIdToErrorResponse(
  sessionId: string | null | undefined,
  response: Response
): Promise<Response> {
  if (!sessionId) return response;
  if (response.status < 400) return response;

  const headers = new Headers(response.headers);
  headers.set("x-cch-session-id", sessionId);

  const contentType = headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return new Response(response.body, { status: response.status, headers });
  }

  if (!contentType.includes("application/json")) {
    return new Response(response.body, { status: response.status, headers });
  }

  let text: string;
  try {
    text = await response.clone().text();
  } catch {
    return new Response(response.body, { status: response.status, headers });
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      parsed.error &&
      typeof parsed.error === "object" &&
      "message" in parsed.error &&
      typeof (parsed.error as { message?: unknown }).message === "string"
    ) {
      const p = parsed as { error: { message: string } } & Record<string, unknown>;
      p.error.message = attachSessionIdToErrorMessage(sessionId, p.error.message);
      return new Response(JSON.stringify(p), { status: response.status, headers });
    }
  } catch {
    // best-effort: keep original response body
  }

  return new Response(text, { status: response.status, headers });
}

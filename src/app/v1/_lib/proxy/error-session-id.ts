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

  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.includes("application/json")) {
    return response;
  }

  let text: string;
  try {
    text = await response.clone().text();
  } catch {
    return response;
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
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.delete("transfer-encoding");
      headers.delete("content-encoding");
      headers.delete("content-range");
      headers.delete("content-md5");
      headers.delete("digest");
      headers.delete("content-digest");
      return new Response(JSON.stringify(p), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
  } catch {
    // best-effort: keep original response body
  }

  return response;
}

import { describe, expect, test } from "vitest";
import { localeCookieName } from "@/i18n/config";

const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:13500";

async function fetchRedirect(path: string, cookie?: string) {
  return fetch(`${APP_BASE_URL}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : undefined,
  });
}

describe("i18n routing e2e", () => {
  test("unprefixed protected routes use NEXT_LOCALE for the login redirect", async () => {
    const response = await fetchRedirect("/dashboard", `${localeCookieName}=en`);

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("location")).toContain("/en/login?from=%2Fdashboard");
  });

  test("repeated locale prefixes do not leak into the login from parameter", async () => {
    const response = await fetchRedirect("/en/en/dashboard");
    const location = response.headers.get("location");

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(location).toContain("/en/login?from=%2Fdashboard");
    expect(location).not.toContain("from=%2Fen%2Fdashboard");
  });
});

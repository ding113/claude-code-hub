import type { Context } from "hono";
import type { ActionResult } from "@/actions/types";
import type { ResolvedAuth } from "./auth-middleware";
import { runWithHonoRequestContext } from "./request-context";

type ServerAction<T> = (...args: never[]) => Promise<ActionResult<T> | T>;

export async function callAction<T>(
  c: Context,
  action: ServerAction<T>,
  args: never[],
  auth?: ResolvedAuth
): Promise<ActionResult<T>> {
  const invoke = () => runWithHonoRequestContext(c, () => action(...args));
  const rawResult =
    auth?.session != null
      ? await (await import("@/lib/auth")).runWithAuthSession(auth.session, invoke, {
          allowReadOnlyAccess: auth.allowReadOnlyAccess,
        })
      : await invoke();

  return rawResult && typeof rawResult === "object" && "ok" in rawResult
    ? (rawResult as ActionResult<T>)
    : ({ ok: true, data: rawResult as T } as ActionResult<T>);
}

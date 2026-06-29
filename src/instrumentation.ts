/**
 * Runtime dispatcher for Next.js instrumentation.
 *
 * Next.js evaluates instrumentation in both Node.js and Edge contexts.
 * Keep this file Edge-safe and dynamically import runtime-specific code.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const runtime = await import("./instrumentation-node");
    await runtime.register();
    return;
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    const runtime = await import("./instrumentation-edge");
    await runtime.register();
  }
}

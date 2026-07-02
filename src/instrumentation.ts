export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { register: registerNodeInstrumentation } = await import("./instrumentation-node");
  await registerNodeInstrumentation();
}

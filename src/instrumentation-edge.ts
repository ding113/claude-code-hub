/**
 * Edge runtime instrumentation entrypoint.
 *
 * Keep this module free of Node-only imports so Turbopack can build the
 * edge instrumentation bundle without pulling in server startup code.
 */
export async function register() {}

import http from "node:http";
import { createResponsesWebSocketProxyGuardExecutor } from "../src/server/responses-websocket-proxy-executor";
import { attachResponsesWebSocketRuntime } from "../src/server/responses-websocket-runtime";

const originalCreateServer = http.createServer;
let runtimeAttached = false;

http.createServer = function createServerWithResponsesWebSocket(
  ...args: Parameters<typeof http.createServer>
): ReturnType<typeof http.createServer> {
  const server = originalCreateServer(...args);

  if (!runtimeAttached) {
    runtimeAttached = true;
    attachResponsesWebSocketRuntime(server, {
      executor: createResponsesWebSocketProxyGuardExecutor(),
      destroyUnhandledUpgrades: false,
      interceptUpgradeEmit: true,
    });
  }

  return server;
};

const requireNextStandaloneServer = eval("require") as NodeRequire;
requireNextStandaloneServer("./next-server.js");

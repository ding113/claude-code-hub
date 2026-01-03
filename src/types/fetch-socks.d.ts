/**
 * fetch-socks 类型声明（项目内最小可用版本）
 *
 * 背景：fetch-socks 目前未提供完整的 TypeScript 类型声明，但本项目仅使用 socksDispatcher
 * 来创建 undici 兼容的 Dispatcher（用于 SOCKS4/SOCKS5 代理）。
 *
 * 说明：这里的类型只覆盖本项目的使用场景，避免 typecheck 失败。
 */
declare module "fetch-socks" {
  import type { Dispatcher } from "undici";

  export type SocksDispatcherOptions = {
    type: 4 | 5;
    host: string;
    port: number;
    userId?: string;
    password?: string;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type SocksDispatcherConnectOptions = any;

  export function socksDispatcher(
    options: SocksDispatcherOptions,
    connectOptions?: SocksDispatcherConnectOptions
  ): Dispatcher;
}

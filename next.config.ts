import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Create next-intl plugin with i18n request configuration
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",

  // Disable ESLint during builds (using Biome instead)
  eslint: {
    ignoreDuringBuilds: true,
  },

  // 转译 ESM 模块（@lobehub/icons 需要）
  transpilePackages: ["@lobehub/icons"],

  // 排除服务端专用包（避免打包到客户端）
  // bull 和相关依赖只在服务端使用，包含 Node.js 原生模块
  // postgres 和 drizzle-orm 包含 Node.js 原生模块（net, tls, crypto, stream, perf_hooks）
  serverExternalPackages: [
    "bull",
    "bullmq",
    "@bull-board/api",
    "@bull-board/express",
    "ioredis",
    "postgres",
    "drizzle-orm",
  ],

  // 强制包含 undici 到 standalone 输出
  // Next.js 依赖追踪无法正确追踪动态导入和类型导入的传递依赖
  // 参考: https://nextjs.org/docs/app/api-reference/config/next-config-js/output
  outputFileTracingIncludes: {
    "/**": ["./node_modules/undici/**/*", "./node_modules/socks-proxy-agent/**/*"],
  },

  // 文件上传大小限制（用于数据库备份导入）
  // Next.js 15 通过 serverActions.bodySizeLimit 统一控制
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },

  // Webpack 配置：显式标记 Node.js 内置模块为 external
  // 修复 CI 构建时 postgres 包导入 net/tls/crypto 等模块的问题
  webpack: (config, { isServer }) => {
    if (isServer) {
      // 排除 Node.js 内置模块，避免打包到服务端 bundle
      config.externals.push({
        net: "commonjs net",
        tls: "commonjs tls",
        crypto: "commonjs crypto",
        stream: "commonjs stream",
        perf_hooks: "commonjs perf_hooks",
        fs: "commonjs fs",
        path: "commonjs path",
        os: "commonjs os",
      });
    }
    return config;
  },
};

// Wrap the Next.js config with next-intl plugin
export default withNextIntl(nextConfig);

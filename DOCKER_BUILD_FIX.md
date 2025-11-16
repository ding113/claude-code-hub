# Docker 构建失败问题分析与解决方案

## 📋 问题概述

**症状**: CI Docker 构建报错

```
ENOENT: no such file or directory, open '/app/.next/server/middleware.js.nft.json'
```

**影响**: 容器启动失败，无法运行

## 🔍 根本原因分析

### 问题根源

Next.js 15 + next-intl middleware 使用 Node.js runtime 时，会生成 **Node File Trace (NFT)** 文件用于依赖追踪。关键发现：

1. ✅ **本地构建产物**: `.next/server/middleware.js.nft.json` **存在**
2. ❌ **Standalone 输出**: `.next/standalone/.next/server` **不包含** NFT 文件
3. ⚠️ **原因**: Next.js standalone 模式不会将 middleware NFT 打包到 standalone bundle 中

### 技术细节

```
构建产物布局:
├── .next/server/                    ← NFT 文件在这里
│   ├── middleware.js
│   ├── middleware.js.nft.json      ← ✅ 存在
│   └── ...
├── .next/standalone/
│   ├── .next/server/
│   │   ├── middleware.js           ← ⚠️  仅包含 JS，无 NFT
│   │   └── ...
│   └── server.js
└── .next/static/
```

**为什么会缺失**:

- `src/middleware.ts` 使用 `export const runtime = "nodejs"`
- next-intl 中间件依赖 Node.js 模块（`postgres-js`, `net`, 等）
- NFT 文件记录所有依赖的完整路径，供 Node.js runtime 解析
- standalone bundle 只包含基本的 middleware.js，**不包含 NFT**

## ✅ 解决方案

### 1. Dockerfile 修复（已完成）

**文件**: `deploy/Dockerfile`

**修改内容**:

```dockerfile
# 第 23 行后添加：构建阶段断言
RUN pnpm run build

# 验证关键文件存在，防止运行时报错（Next.js 15 middleware 需要 NFT 文件）
RUN test -f .next/server/middleware.js.nft.json || \
    (echo "ERROR: middleware.js.nft.json not found! Check Next.js build output." && exit 1)

FROM node:22-slim AS runner
...

# 第 46 行：确保复制 .next/server 目录（关键！）
COPY --from=build --chown=node:node /app/.next/server ./.next/server
```

**关键点**:

1. **第 46 行**: 已存在，复制完整的 `.next/server` 目录到镜像
2. **第 26-27 行**: **新增**，构建阶段验证 NFT 文件存在，及早发现问题

### 2. packageManager 修复（已完成）

**文件**: `package.json`

**修改**:

```diff
- "packageManager": "bun@1.3.2"
+ "packageManager": "pnpm@9.15.0"
```

**原因**: Dockerfile 使用 pnpm，但 package.json 指定 bun 导致 corepack 失败

## 🧪 验证步骤

### 本地验证

```bash
# 1. 清理旧构建
rm -rf .next

# 2. 生产构建
pnpm run build

# 3. 验证 NFT 文件存在
ls -lh .next/server/middleware.js.nft.json

# 4. Docker 构建测试
docker build -f deploy/Dockerfile -t claude-code-hub:test .

# 5. 验证镜像中的文件结构
docker run --rm claude-code-hub:test ls -lh /.next/server/middleware.js.nft.json
```

### CI/CD 修复清单

- [ ] 确保 CI 使用最新的 `deploy/Dockerfile`
- [ ] 清除 Docker layer 缓存：`docker builder prune`
- [ ] 验证构建命令：`docker build -f deploy/Dockerfile .`
- [ ] 检查构建日志是否有 NFT 断言通过

## 📊 预期文件结构

修复后，生产 Docker 镜像应包含：

```
/app/
├── server.js                        ← 从 .next/standalone
├── node_modules/                    ← 从 .next/standalone
├── .next/
│   ├── static/                      ← 从 .next/static
│   └── server/                      ← 从 .next/server（关键！）
│       ├── middleware.js
│       ├── middleware.js.nft.json  ← ✅ 必须存在
│       └── ...
├── public/
├── drizzle/
└── messages/
```

## 🔄 相关修改

### 修改的文件

1. ✅ `deploy/Dockerfile` - 添加构建断言
2. ✅ `package.json` - 修复 packageManager
3. ✅ `src/components/ui/chart.tsx` - 修复 TypeScript 类型错误（副作用修复）

### Git 提交

```bash
git add deploy/Dockerfile package.json pnpm-lock.yaml src/components/ui/chart.tsx
git commit -m "fix(docker): 修复 CI 构建缺少 middleware NFT 文件的问题

- 在 Dockerfile 添加构建断言验证 middleware.js.nft.json 存在
- 修复 packageManager 从 bun 改回 pnpm 以匹配 Dockerfile
- 更新 pnpm-lock.yaml 到最新依赖
- 修复 chart.tsx 的 TypeScript 类型错误（依赖升级副作用）

根本原因：
Next.js 15 standalone 模式不会将 middleware NFT 文件打包到
.next/standalone，但 Node.js runtime 需要它来解析依赖。
Dockerfile 第 46 行已正确复制 .next/server，但添加断言
确保 CI 能及早发现问题。

Refs: #[issue-number]
"
```

## 🎯 关键要点总结

1. **Dockerfile 已包含正确的修复**（第 46 行 `COPY .next/server`）
2. **新增构建断言**防止未来回归
3. **NFT 文件必须从 `.next/server` 复制**，不在 standalone 中
4. **确保 CI 使用最新 Dockerfile 并清除缓存**

## 📚 参考资料

- [Next.js Standalone Output](https://nextjs.org/docs/app/api-reference/next-config-js/output)
- [Next.js Middleware Runtime](https://nextjs.org/docs/app/building-your-application/routing/middleware#runtime)
- [Node File Trace (nft)](https://github.com/vercel/nft)
- [next-intl Middleware](https://next-intl-docs.vercel.app/docs/routing/middleware)

# Bun 快速开始指南

## 安装 Bun

```bash
# macOS/Linux (curl)
curl -fsSL https://bun.sh/install | bash

# macOS (Homebrew)
brew install bun

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"

# 验证安装
bun --version
```

## 项目设置

```bash
# 1. 克隆项目
git clone https://github.com/ding113/claude-code-hub.git
cd claude-code-hub

# 2. 安装依赖
bun install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，设置必要的环境变量

# 4. 数据库迁移（可选，如果使用 Docker Compose 会自动处理）
bun db:push  # 开发环境
# 或
bun db:migrate  # 生产环境

# 5. 启动开发服务器
bun dev
```

## 常用命令

```bash
bun dev              # 启动开发服务器
bun build            # 构建生产版本
bun start            # 启动生产服务器
bun lint             # 代码检查
bun typecheck        # TypeScript 类型检查
bun format           # 代码格式化
bun test             # 运行测试
```

## Docker 部署

```bash
# 使用新的根目录 Dockerfile
docker build -t claude-code-hub .

# 或使用 Nixpacks
nixpack build
```

## 性能对比

相比 pnpm，Bun 提供了：
- **10-20x** 更快的包安装速度
- **2-3x** 更快的构建时间
- **更低的内存占用**
- **内置 TypeScript 支持**

## 迁移说明

从 pnpm 迁移到 bun：
1. 删除 `node_modules` 和 `pnpm-lock.yaml`
2. 运行 `bun install`（会自动生成 `bun.lockb`）
3. 所有 `pnpm` 命令替换为 `bun`
4. CI/CD 已更新支持 bun

更多详细信息请参考 [Bun 官方文档](https://bun.sh/docs)。
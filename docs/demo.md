# 本地 Demo（无 Docker / 内置数据库）

本项目默认使用 Postgres + Redis（推荐通过 `dev/Makefile` + Docker Compose 启动）。

如果你的环境没有 Docker/Postgres/Redis，也可以使用内置数据库（PGlite）启动一个可登录、可浏览仪表盘的本地 Demo。

## 启动

```bash
bun install
bun run demo
```

启动后会在控制台打印：

- 访问地址（`/zh-CN/login`、`/zh-CN/dashboard`）
- 管理员登录令牌（`ADMIN_TOKEN`）
- 内置数据库目录（`CCH_EMBEDDED_DB_DIR`）

## 数据与重置

- Demo 默认会自动执行迁移，并在空库时写入一组最小种子数据（用户/Key/用量账本），用于展示首页统计图表等页面。
- 如需重置 Demo 数据，停止服务后删除内置数据库目录（默认：`data/pglite-demo`）。

## 注意事项

- 内置数据库仅用于本地 Demo/开发体验，不建议用于生产部署。
- 生产环境仍需配置 `DSN`（Postgres）与 `REDIS_URL`（可选，用于限流与 Session 追踪）。


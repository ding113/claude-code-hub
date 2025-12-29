# ================================
# Claude Code Hub - 根目录快捷命令
# ================================
#
# 这个 Makefile 将命令转发到 dev/Makefile
# 可以在项目根目录直接执行 make 命令

.PHONY: help dev-help dev db app build build-nocache app-rebuild app-nocache prune-images rm-app-image compose clean migrate db-shell redis-shell logs logs-app logs-db logs-redis reset status stop

# 默认目标：显示 dev 工具帮助
.DEFAULT_GOAL := dev-help

# 显示 dev 工具帮助
dev-help:
	@cd dev && $(MAKE) help

# 转发所有命令到 dev/Makefile
dev db app build build-nocache app-rebuild app-nocache prune-images rm-app-image compose clean migrate db-shell redis-shell logs logs-app logs-db logs-redis reset status stop:
	@cd dev && $(MAKE) $@

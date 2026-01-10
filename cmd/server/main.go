package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ding113/claude-code-hub/internal/config"
	"github.com/ding113/claude-code-hub/internal/database"
	"github.com/ding113/claude-code-hub/internal/pkg/logger"
	"github.com/ding113/claude-code-hub/internal/pkg/validator"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/uptrace/bun"
)

func main() {
	// 加载配置
	cfg, err := config.Load()
	if err != nil {
		fmt.Printf("Failed to load config: %v\n", err)
		os.Exit(1)
	}

	// 初始化日志
	logger.Init(logger.Config{
		Level:  cfg.Log.Level,
		Format: cfg.Log.Format,
	})

	logger.Info().Msg("Starting Claude Code Hub...")

	// 初始化验证器
	validator.Init()

	// 连接数据库
	db, err := database.NewPostgres(cfg.Database)
	if err != nil {
		logger.Fatal().Err(err).Msg("Failed to connect to PostgreSQL")
	}
	defer database.ClosePostgres(db)

	// 连接 Redis
	rdb, err := database.NewRedis(cfg.Redis)
	if err != nil {
		logger.Fatal().Err(err).Msg("Failed to connect to Redis")
	}
	defer database.CloseRedis(rdb)

	// 创建 Gin 引擎
	if cfg.Log.Level != "debug" {
		gin.SetMode(gin.ReleaseMode)
	}
	router := setupRouter(db, rdb)

	// 创建 HTTP 服务器
	srv := &http.Server{
		Addr:         fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port),
		Handler:      router,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
	}

	// 启动服务器
	go func() {
		logger.Info().
			Str("host", cfg.Server.Host).
			Int("port", cfg.Server.Port).
			Msg("Server listening")

		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal().Err(err).Msg("Server failed")
		}
	}()

	// 等待中断信号
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info().Msg("Shutting down server...")

	// 优雅关闭
	ctx, cancel := context.WithTimeout(context.Background(), cfg.Server.ShutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Error().Err(err).Msg("Server forced to shutdown")
	}

	logger.Info().Msg("Server exited")
}

// setupRouter 设置路由
func setupRouter(db *bun.DB, rdb *redis.Client) *gin.Engine {
	router := gin.New()

	// 添加中间件
	router.Use(gin.Recovery())
	router.Use(requestLogger())

	// 健康检查
	router.GET("/health", healthCheck(db, rdb))

	// API v1 路由组 (代理 API)
	v1 := router.Group("/v1")
	{
		// TODO: Phase 5 实现
		v1.POST("/messages", notImplemented)
		v1.POST("/chat/completions", notImplemented)
		v1.POST("/responses", notImplemented)
		v1.GET("/models", notImplemented)
	}

	// 管理 API 路由组
	api := router.Group("/api/actions")
	{
		// TODO: Phase 5 实现
		api.GET("/users", notImplemented)
		api.GET("/users/:id", notImplemented)
		api.POST("/users", notImplemented)
		api.PUT("/users/:id", notImplemented)
		api.DELETE("/users/:id", notImplemented)

		api.GET("/keys", notImplemented)
		api.GET("/keys/:id", notImplemented)
		api.POST("/keys", notImplemented)
		api.PUT("/keys/:id", notImplemented)
		api.DELETE("/keys/:id", notImplemented)

		api.GET("/providers", notImplemented)
		api.GET("/providers/:id", notImplemented)
		api.POST("/providers", notImplemented)
		api.PUT("/providers/:id", notImplemented)
		api.DELETE("/providers/:id", notImplemented)
	}

	return router
}

// requestLogger 请求日志中间件
func requestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path

		c.Next()

		latency := time.Since(start)
		status := c.Writer.Status()

		logger.Info().
			Str("method", c.Request.Method).
			Str("path", path).
			Int("status", status).
			Dur("latency", latency).
			Str("client_ip", c.ClientIP()).
			Msg("Request")
	}
}

// healthCheck 健康检查处理器
func healthCheck(db *bun.DB, rdb *redis.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()

		// 检查数据库连接
		if err := db.PingContext(ctx); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"status":   "unhealthy",
				"database": "disconnected",
				"error":    err.Error(),
			})
			return
		}

		// 检查 Redis 连接
		if err := rdb.Ping(ctx).Err(); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"status":   "unhealthy",
				"redis":    "disconnected",
				"database": "connected",
				"error":    err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"status":   "healthy",
			"database": "connected",
			"redis":    "connected",
		})
	}
}

// notImplemented 未实现的处理器
func notImplemented(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{
		"error": gin.H{
			"type":    "not_implemented",
			"message": "This endpoint is not yet implemented",
		},
	})
}

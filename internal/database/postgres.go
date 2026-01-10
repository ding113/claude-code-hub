package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/ding113/claude-code-hub/internal/config"
	"github.com/ding113/claude-code-hub/internal/pkg/logger"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

var (
	// 单例模式，与 Node.js 版本保持一致
	dbInstance *bun.DB
	dbOnce     sync.Once
	dbErr      error
)

// PostgresDB 封装 PostgreSQL 数据库连接
type PostgresDB struct {
	DB  *bun.DB
	cfg config.DatabaseConfig
}

// NewPostgres 创建 PostgreSQL 数据库连接
// 支持两种配置方式：
// 1. DSN 连接字符串（优先）
// 2. 分离的配置字段
func NewPostgres(cfg config.DatabaseConfig) (*bun.DB, error) {
	// 获取 DSN
	dsn := cfg.DSN
	if dsn == "" {
		// 如果没有 DSN，则从分离的配置字段构建
		dsn = buildDSN(cfg)
	}

	// 验证 DSN 不为空
	if dsn == "" {
		return nil, errors.New("DSN environment variable is not set")
	}

	// 检查是否为占位符模板（与 Node.js 版本保持一致）
	if strings.Contains(dsn, "user:password@host:port") {
		return nil, errors.New("DSN contains placeholder template, please set a valid DSN")
	}

	// 创建连接器
	connector := pgdriver.NewConnector(
		pgdriver.WithDSN(dsn),
		pgdriver.WithDialTimeout(cfg.ConnectTimeout),
		pgdriver.WithReadTimeout(cfg.IdleTimeout), // 读取超时使用空闲超时
	)

	// 创建 sql.DB
	sqlDB := sql.OpenDB(connector)

	// 设置连接池参数
	// MaxOpenConns: 最大打开连接数
	// - 与 Node.js 版本的 max 参数对应
	sqlDB.SetMaxOpenConns(cfg.PoolMax)

	// MaxIdleConns: 最大空闲连接数
	sqlDB.SetMaxIdleConns(cfg.MaxIdleConns)

	// ConnMaxLifetime: 连接最大生命周期
	sqlDB.SetConnMaxLifetime(cfg.ConnMaxLifetime)

	// ConnMaxIdleTime: 空闲连接最大存活时间
	// - 与 Node.js 版本的 idle_timeout 参数对应
	sqlDB.SetConnMaxIdleTime(cfg.IdleTimeout)

	// 创建 Bun DB
	db := bun.NewDB(sqlDB, pgdialect.New())

	// 测试连接
	ctx, cancel := context.WithTimeout(context.Background(), cfg.ConnectTimeout)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	// 记录连接信息（隐藏敏感信息）
	logDSN := sanitizeDSN(dsn)
	logger.Info().
		Str("dsn", logDSN).
		Int("pool_max", cfg.PoolMax).
		Int("max_idle_conns", cfg.MaxIdleConns).
		Dur("idle_timeout", cfg.IdleTimeout).
		Dur("connect_timeout", cfg.ConnectTimeout).
		Dur("conn_max_lifetime", cfg.ConnMaxLifetime).
		Msg("PostgreSQL connected")

	return db, nil
}

// GetDB 获取数据库单例（懒加载）
// 与 Node.js 版本的 getDb() 函数对应
func GetDB(cfg config.DatabaseConfig) (*bun.DB, error) {
	dbOnce.Do(func() {
		dbInstance, dbErr = NewPostgres(cfg)
	})
	return dbInstance, dbErr
}

// ClosePostgres 关闭数据库连接
func ClosePostgres(db *bun.DB) error {
	if db != nil {
		logger.Info().Msg("Closing PostgreSQL connection")
		return db.Close()
	}
	return nil
}

// HealthCheck 健康检查
// 返回数据库连接状态和统计信息
func HealthCheck(ctx context.Context, db *bun.DB) (*HealthStatus, error) {
	if db == nil {
		return nil, errors.New("database connection is nil")
	}

	status := &HealthStatus{
		Healthy:   false,
		Timestamp: time.Now(),
	}

	// 执行 ping 检查
	start := time.Now()
	err := db.PingContext(ctx)
	status.Latency = time.Since(start)

	if err != nil {
		status.Error = err.Error()
		return status, err
	}

	status.Healthy = true

	// 获取连接池统计信息
	sqlDB := db.DB
	stats := sqlDB.Stats()
	status.Stats = &PoolStats{
		MaxOpenConnections: stats.MaxOpenConnections,
		OpenConnections:    stats.OpenConnections,
		InUse:              stats.InUse,
		Idle:               stats.Idle,
		WaitCount:          stats.WaitCount,
		WaitDuration:       stats.WaitDuration,
		MaxIdleClosed:      stats.MaxIdleClosed,
		MaxLifetimeClosed:  stats.MaxLifetimeClosed,
	}

	return status, nil
}

// HealthStatus 健康检查状态
type HealthStatus struct {
	Healthy   bool          `json:"healthy"`
	Latency   time.Duration `json:"latency"`
	Error     string        `json:"error,omitempty"`
	Timestamp time.Time     `json:"timestamp"`
	Stats     *PoolStats    `json:"stats,omitempty"`
}

// PoolStats 连接池统计信息
type PoolStats struct {
	MaxOpenConnections int           `json:"max_open_connections"`
	OpenConnections    int           `json:"open_connections"`
	InUse              int           `json:"in_use"`
	Idle               int           `json:"idle"`
	WaitCount          int64         `json:"wait_count"`
	WaitDuration       time.Duration `json:"wait_duration"`
	MaxIdleClosed      int64         `json:"max_idle_closed"`
	MaxLifetimeClosed  int64         `json:"max_lifetime_closed"`
}

// buildDSN 从分离的配置字段构建 DSN
func buildDSN(cfg config.DatabaseConfig) string {
	if cfg.Host == "" {
		return ""
	}

	return fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		cfg.User,
		cfg.Password,
		cfg.Host,
		cfg.Port,
		cfg.DBName,
		cfg.SSLMode,
	)
}

// sanitizeDSN 清理 DSN 中的敏感信息（用于日志）
func sanitizeDSN(dsn string) string {
	// 简单处理：隐藏密码部分
	// postgres://user:password@host:port/dbname -> postgres://user:***@host:port/dbname
	if !strings.Contains(dsn, "://") {
		return dsn
	}

	parts := strings.SplitN(dsn, "://", 2)
	if len(parts) != 2 {
		return dsn
	}

	protocol := parts[0]
	rest := parts[1]

	// 查找 @ 符号
	atIndex := strings.Index(rest, "@")
	if atIndex == -1 {
		return dsn
	}

	userPass := rest[:atIndex]
	hostAndRest := rest[atIndex:]

	// 查找密码部分
	colonIndex := strings.Index(userPass, ":")
	if colonIndex == -1 {
		return dsn
	}

	user := userPass[:colonIndex]
	return fmt.Sprintf("%s://%s:***%s", protocol, user, hostAndRest)
}

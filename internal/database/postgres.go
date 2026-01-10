package database

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/ding113/claude-code-hub/internal/config"
	"github.com/ding113/claude-code-hub/internal/pkg/logger"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

// NewPostgres 创建 PostgreSQL 数据库连接
func NewPostgres(cfg config.DatabaseConfig) (*bun.DB, error) {
	// 构建 DSN
	dsn := fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		cfg.User,
		cfg.Password,
		cfg.Host,
		cfg.Port,
		cfg.DBName,
		cfg.SSLMode,
	)

	// 创建连接器
	connector := pgdriver.NewConnector(
		pgdriver.WithDSN(dsn),
		pgdriver.WithTimeout(cfg.ConnLifetime),
	)

	// 创建 sql.DB
	sqlDB := sql.OpenDB(connector)

	// 设置连接池参数
	sqlDB.SetMaxOpenConns(cfg.MaxOpenConns)
	sqlDB.SetMaxIdleConns(cfg.MaxIdleConns)
	sqlDB.SetConnMaxLifetime(cfg.ConnLifetime)

	// 创建 Bun DB
	db := bun.NewDB(sqlDB, pgdialect.New())

	// 测试连接
	if err := db.PingContext(context.Background()); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	logger.Info().
		Str("host", cfg.Host).
		Int("port", cfg.Port).
		Str("database", cfg.DBName).
		Msg("PostgreSQL connected")

	return db, nil
}

// ClosePostgres 关闭数据库连接
func ClosePostgres(db *bun.DB) error {
	if db != nil {
		logger.Info().Msg("Closing PostgreSQL connection")
		return db.Close()
	}
	return nil
}

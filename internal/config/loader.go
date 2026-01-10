package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// Load 加载配置
func Load() (*Config, error) {
	v := viper.New()

	// 设置默认值
	setDefaults(v)

	// 配置文件设置
	v.SetConfigName("config")
	v.SetConfigType("yaml")
	v.AddConfigPath(".")
	v.AddConfigPath("./config")
	v.AddConfigPath("/etc/claude-code-hub")

	// 环境变量设置
	v.SetEnvPrefix("")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	// 绑定环境变量
	bindEnvVariables(v)

	// 读取配置文件（可选）
	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("failed to read config file: %w", err)
		}
		// 配置文件不存在，使用环境变量和默认值
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	// 验证配置
	if err := validate(&cfg); err != nil {
		return nil, fmt.Errorf("config validation failed: %w", err)
	}

	return &cfg, nil
}

// setDefaults 设置默认值
// 与 Node.js 版本的 env.schema.ts 保持一致
func setDefaults(v *viper.Viper) {
	// 环境模式
	v.SetDefault("env", "development")

	// 时区
	v.SetDefault("timezone", "Asia/Shanghai")

	// 调试模式
	v.SetDefault("debug_mode", false)

	// 自动迁移
	v.SetDefault("auto_migrate", true)

	// Server defaults
	v.SetDefault("server.port", 23000) // 与 Node.js 版本保持一致
	v.SetDefault("server.host", "0.0.0.0")
	v.SetDefault("server.read_timeout", 30*time.Second)
	v.SetDefault("server.write_timeout", 120*time.Second) // SSE 需要较长超时
	v.SetDefault("server.shutdown_timeout", 30*time.Second)

	// Database defaults
	v.SetDefault("database.dsn", "")
	v.SetDefault("database.host", "localhost")
	v.SetDefault("database.port", 5432)
	v.SetDefault("database.user", "postgres")
	v.SetDefault("database.password", "")
	v.SetDefault("database.dbname", "claude_code_hub")
	v.SetDefault("database.sslmode", "disable")
	v.SetDefault("database.pool_max", 20)                    // 与 Node.js 版本一致，范围 1-200
	v.SetDefault("database.max_idle_conns", 5)               // 最大空闲连接数
	v.SetDefault("database.idle_timeout", 20*time.Second)    // 与 Node.js 版本一致，范围 0-3600
	v.SetDefault("database.connect_timeout", 10*time.Second) // 与 Node.js 版本一致，范围 1-120
	v.SetDefault("database.conn_max_lifetime", 30*time.Minute)

	// Redis defaults
	v.SetDefault("redis.url", "")
	v.SetDefault("redis.host", "localhost")
	v.SetDefault("redis.port", 6379)
	v.SetDefault("redis.password", "")
	v.SetDefault("redis.db", 0)
	v.SetDefault("redis.pool_size", 10)
	v.SetDefault("redis.min_idle_conns", 2)
	v.SetDefault("redis.dial_timeout", 5*time.Second)
	v.SetDefault("redis.read_timeout", 3*time.Second)
	v.SetDefault("redis.write_timeout", 3*time.Second)
	v.SetDefault("redis.tls_reject_unauthorized", true) // 与 Node.js 版本一致
	v.SetDefault("redis.max_retries", 3)
	v.SetDefault("redis.min_retry_backoff", 200*time.Millisecond)
	v.SetDefault("redis.max_retry_backoff", 2*time.Second)
	v.SetDefault("redis.enabled", true)

	// Log defaults
	v.SetDefault("log.level", "info") // 与 Node.js 版本一致
	v.SetDefault("log.format", "json")

	// Auth defaults
	v.SetDefault("auth.admin_token", "")

	// MessageRequest defaults - 与 Node.js 版本一致
	v.SetDefault("message_request.write_mode", "async")           // 默认异步写入
	v.SetDefault("message_request.async_flush_interval_ms", 1000) // 1秒刷新间隔
	v.SetDefault("message_request.async_batch_size", 100)         // 批量大小
	v.SetDefault("message_request.async_max_pending", 10000)      // 最大待处理数

	// Features defaults - 与 Node.js 版本一致
	v.SetDefault("features.enable_rate_limit", true)
	v.SetDefault("features.enable_secure_cookies", true)
	v.SetDefault("features.enable_multi_provider_types", false)
	v.SetDefault("features.enable_circuit_breaker_on_network_errors", false)
	v.SetDefault("features.enable_provider_cache", true)
	v.SetDefault("features.enable_smart_probing", false)

	// Proxy defaults - 与 Node.js 版本一致
	v.SetDefault("proxy.max_retry_attempts_default", 2)          // 范围 1-10
	v.SetDefault("proxy.fetch_body_timeout", 600*time.Second)    // 600秒
	v.SetDefault("proxy.fetch_headers_timeout", 600*time.Second) // 600秒
	v.SetDefault("proxy.fetch_connect_timeout", 30*time.Second)  // 30秒

	// Session defaults - 与 Node.js 版本一致
	v.SetDefault("session.ttl", 300) // 300秒
	v.SetDefault("session.store_session_messages", false)

	// SmartProbing defaults - 与 Node.js 版本一致
	v.SetDefault("smart_probing.interval_ms", 30000) // 30秒
	v.SetDefault("smart_probing.timeout_ms", 5000)   // 5秒

	// APITest defaults - 与 Node.js 版本一致
	v.SetDefault("api_test.timeout_ms", 15000) // 15秒

	// App defaults
	v.SetDefault("app.url", "")
}

// bindEnvVariables 绑定环境变量
// 环境变量名称与 Node.js 版本保持一致
func bindEnvVariables(v *viper.Viper) {
	// 环境模式
	_ = v.BindEnv("env", "NODE_ENV")

	// 时区
	_ = v.BindEnv("timezone", "TZ")

	// 调试模式
	_ = v.BindEnv("debug_mode", "DEBUG_MODE")

	// 自动迁移
	_ = v.BindEnv("auto_migrate", "AUTO_MIGRATE")

	// Server - 与 Node.js 版本保持一致
	_ = v.BindEnv("server.port", "PORT")
	_ = v.BindEnv("server.host", "SERVER_HOST")
	_ = v.BindEnv("server.read_timeout", "SERVER_READ_TIMEOUT")
	_ = v.BindEnv("server.write_timeout", "SERVER_WRITE_TIMEOUT")
	_ = v.BindEnv("server.shutdown_timeout", "SERVER_SHUTDOWN_TIMEOUT")

	// Database - 与 Node.js 版本保持一致
	_ = v.BindEnv("database.dsn", "DSN")
	_ = v.BindEnv("database.host", "DATABASE_HOST")
	_ = v.BindEnv("database.port", "DATABASE_PORT")
	_ = v.BindEnv("database.user", "DATABASE_USER")
	_ = v.BindEnv("database.password", "DATABASE_PASSWORD")
	_ = v.BindEnv("database.dbname", "DATABASE_NAME")
	_ = v.BindEnv("database.sslmode", "DATABASE_SSLMODE")
	_ = v.BindEnv("database.pool_max", "DB_POOL_MAX")
	_ = v.BindEnv("database.max_idle_conns", "DATABASE_MAX_IDLE_CONNS")
	_ = v.BindEnv("database.idle_timeout", "DB_POOL_IDLE_TIMEOUT")
	_ = v.BindEnv("database.connect_timeout", "DB_POOL_CONNECT_TIMEOUT")
	_ = v.BindEnv("database.conn_max_lifetime", "DATABASE_CONN_MAX_LIFETIME")

	// Redis - 与 Node.js 版本保持一致
	_ = v.BindEnv("redis.url", "REDIS_URL")
	_ = v.BindEnv("redis.host", "REDIS_HOST")
	_ = v.BindEnv("redis.port", "REDIS_PORT")
	_ = v.BindEnv("redis.password", "REDIS_PASSWORD")
	_ = v.BindEnv("redis.db", "REDIS_DB")
	_ = v.BindEnv("redis.pool_size", "REDIS_POOL_SIZE")
	_ = v.BindEnv("redis.min_idle_conns", "REDIS_MIN_IDLE_CONNS")
	_ = v.BindEnv("redis.dial_timeout", "REDIS_DIAL_TIMEOUT")
	_ = v.BindEnv("redis.read_timeout", "REDIS_READ_TIMEOUT")
	_ = v.BindEnv("redis.write_timeout", "REDIS_WRITE_TIMEOUT")
	_ = v.BindEnv("redis.tls_reject_unauthorized", "REDIS_TLS_REJECT_UNAUTHORIZED")
	_ = v.BindEnv("redis.max_retries", "REDIS_MAX_RETRIES")
	_ = v.BindEnv("redis.min_retry_backoff", "REDIS_MIN_RETRY_BACKOFF")
	_ = v.BindEnv("redis.max_retry_backoff", "REDIS_MAX_RETRY_BACKOFF")
	_ = v.BindEnv("redis.enabled", "REDIS_ENABLED")

	// Log - 与 Node.js 版本保持一致
	_ = v.BindEnv("log.level", "LOG_LEVEL")
	_ = v.BindEnv("log.format", "LOG_FORMAT")

	// Auth - 与 Node.js 版本保持一致
	_ = v.BindEnv("auth.admin_token", "ADMIN_TOKEN")

	// MessageRequest - 与 Node.js 版本保持一致
	_ = v.BindEnv("message_request.write_mode", "MESSAGE_REQUEST_WRITE_MODE")
	_ = v.BindEnv("message_request.async_flush_interval_ms", "MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS")
	_ = v.BindEnv("message_request.async_batch_size", "MESSAGE_REQUEST_ASYNC_BATCH_SIZE")
	_ = v.BindEnv("message_request.async_max_pending", "MESSAGE_REQUEST_ASYNC_MAX_PENDING")

	// Features - 与 Node.js 版本保持一致
	_ = v.BindEnv("features.enable_rate_limit", "ENABLE_RATE_LIMIT")
	_ = v.BindEnv("features.enable_secure_cookies", "ENABLE_SECURE_COOKIES")
	_ = v.BindEnv("features.enable_multi_provider_types", "ENABLE_MULTI_PROVIDER_TYPES")
	_ = v.BindEnv("features.enable_circuit_breaker_on_network_errors", "ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS")
	_ = v.BindEnv("features.enable_provider_cache", "ENABLE_PROVIDER_CACHE")

	// Proxy - 与 Node.js 版本保持一致
	_ = v.BindEnv("proxy.max_retry_attempts_default", "MAX_RETRY_ATTEMPTS_DEFAULT")
	_ = v.BindEnv("proxy.fetch_body_timeout", "FETCH_BODY_TIMEOUT")
	_ = v.BindEnv("proxy.fetch_headers_timeout", "FETCH_HEADERS_TIMEOUT")
	_ = v.BindEnv("proxy.fetch_connect_timeout", "FETCH_CONNECT_TIMEOUT")

	// Session - 与 Node.js 版本保持一致
	_ = v.BindEnv("session.ttl", "SESSION_TTL")
	_ = v.BindEnv("session.store_session_messages", "STORE_SESSION_MESSAGES")

	// SmartProbing - 与 Node.js 版本保持一致
	_ = v.BindEnv("features.enable_smart_probing", "ENABLE_SMART_PROBING")
	_ = v.BindEnv("smart_probing.interval_ms", "PROBE_INTERVAL_MS")
	_ = v.BindEnv("smart_probing.timeout_ms", "PROBE_TIMEOUT_MS")

	// APITest - 与 Node.js 版本保持一致
	_ = v.BindEnv("api_test.timeout_ms", "API_TEST_TIMEOUT_MS")

	// App - 与 Node.js 版本保持一致
	_ = v.BindEnv("app.url", "APP_URL")
}

// validate 验证配置
func validate(cfg *Config) error {
	// 验证环境模式
	if cfg.Env != "development" && cfg.Env != "production" && cfg.Env != "test" {
		return fmt.Errorf("invalid env: %s, must be one of: development, production, test", cfg.Env)
	}

	// 验证日志级别
	validLogLevels := map[string]bool{
		"fatal": true, "error": true, "warn": true,
		"info": true, "debug": true, "trace": true,
	}
	if !validLogLevels[cfg.Log.Level] {
		return fmt.Errorf("invalid log level: %s, must be one of: fatal, error, warn, info, debug, trace", cfg.Log.Level)
	}

	// 验证数据库连接池配置
	if cfg.Database.PoolMax < 1 || cfg.Database.PoolMax > 200 {
		return fmt.Errorf("invalid database.pool_max: %d, must be between 1 and 200", cfg.Database.PoolMax)
	}

	// 验证数据库空闲超时（秒）- 与 Node.js 版本一致
	idleTimeoutSeconds := int(cfg.Database.IdleTimeout.Seconds())
	if idleTimeoutSeconds < 0 || idleTimeoutSeconds > 3600 {
		return fmt.Errorf("invalid database.idle_timeout: %d seconds, must be between 0 and 3600", idleTimeoutSeconds)
	}

	// 验证数据库连接超时（秒）- 与 Node.js 版本一致
	connectTimeoutSeconds := int(cfg.Database.ConnectTimeout.Seconds())
	if connectTimeoutSeconds < 1 || connectTimeoutSeconds > 120 {
		return fmt.Errorf("invalid database.connect_timeout: %d seconds, must be between 1 and 120", connectTimeoutSeconds)
	}

	// 验证 API 测试超时（毫秒）- 与 Node.js 版本一致
	if cfg.APITest.TimeoutMs < 5000 || cfg.APITest.TimeoutMs > 120000 {
		return fmt.Errorf("invalid api_test.timeout_ms: %d, must be between 5000 and 120000", cfg.APITest.TimeoutMs)
	}

	// 验证消息请求写入模式
	if cfg.MessageRequest.WriteMode != "sync" && cfg.MessageRequest.WriteMode != "async" {
		return fmt.Errorf("invalid message_request.write_mode: %s, must be one of: sync, async", cfg.MessageRequest.WriteMode)
	}

	// 验证异步写入配置
	if cfg.MessageRequest.WriteMode == "async" {
		if cfg.MessageRequest.AsyncFlushIntervalMs < 10 || cfg.MessageRequest.AsyncFlushIntervalMs > 60000 {
			return fmt.Errorf("invalid message_request.async_flush_interval_ms: %d, must be between 10 and 60000", cfg.MessageRequest.AsyncFlushIntervalMs)
		}
		if cfg.MessageRequest.AsyncBatchSize < 1 || cfg.MessageRequest.AsyncBatchSize > 2000 {
			return fmt.Errorf("invalid message_request.async_batch_size: %d, must be between 1 and 2000", cfg.MessageRequest.AsyncBatchSize)
		}
		if cfg.MessageRequest.AsyncMaxPending < 100 || cfg.MessageRequest.AsyncMaxPending > 200000 {
			return fmt.Errorf("invalid message_request.async_max_pending: %d, must be between 100 and 200000", cfg.MessageRequest.AsyncMaxPending)
		}
	}

	// 验证代理配置
	if cfg.Proxy.MaxRetryAttemptsDefault < 1 || cfg.Proxy.MaxRetryAttemptsDefault > 10 {
		return fmt.Errorf("invalid proxy.max_retry_attempts_default: %d, must be between 1 and 10", cfg.Proxy.MaxRetryAttemptsDefault)
	}

	return nil
}

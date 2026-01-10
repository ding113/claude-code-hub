package database

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/ding113/claude-code-hub/internal/config"
	"github.com/ding113/claude-code-hub/internal/pkg/logger"
	"github.com/redis/go-redis/v9"
)

// 默认配置常量（与 Node.js 版本对齐）
const (
	defaultMaxRetries      = 3
	defaultMinRetryBackoff = 200 * time.Millisecond
	defaultMaxRetryBackoff = 2 * time.Second
	defaultPoolSize        = 10
	defaultMinIdleConns    = 2
	defaultDialTimeout     = 5 * time.Second
	defaultReadTimeout     = 3 * time.Second
	defaultWriteTimeout    = 3 * time.Second
)

// maskRedisURL 对 Redis URL 中的密码进行脱敏处理
// 与 Node.js 版本的 maskRedisUrl 函数功能对齐
func maskRedisURL(redisURL string) string {
	if redisURL == "" {
		return ""
	}

	parsed, err := url.Parse(redisURL)
	if err != nil {
		// 解析失败时使用正则替换
		// 匹配 :password@ 格式
		if idx := strings.Index(redisURL, "@"); idx != -1 {
			colonIdx := strings.LastIndex(redisURL[:idx], ":")
			if colonIdx != -1 {
				return redisURL[:colonIdx+1] + "****" + redisURL[idx:]
			}
		}
		return redisURL
	}

	if _, hasPassword := parsed.User.Password(); hasPassword {
		parsed.User = url.UserPassword(parsed.User.Username(), "****")
	}
	return parsed.String()
}

// isTLSEnabled 检测 URL 是否使用 TLS（rediss:// 协议）
func isTLSEnabled(redisURL string) bool {
	if redisURL == "" {
		return false
	}

	parsed, err := url.Parse(redisURL)
	if err != nil {
		// 解析失败时使用字符串前缀检测
		return strings.HasPrefix(redisURL, "rediss://")
	}
	return parsed.Scheme == "rediss"
}

// parseRedisURL 解析 Redis URL 并返回连接选项
// 支持 redis:// 和 rediss:// 协议
func parseRedisURL(redisURL string) (*redis.Options, error) {
	// go-redis 内置支持 URL 解析
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse redis URL: %w", err)
	}
	return opts, nil
}

// buildTLSConfig 构建 TLS 配置
// 与 Node.js 版本的 buildTlsConfig 函数功能对齐
// 支持 SNI (Server Name Indication) 和跳过证书验证
func buildTLSConfig(redisURL string, rejectUnauthorized bool) *tls.Config {
	tlsConfig := &tls.Config{
		InsecureSkipVerify: !rejectUnauthorized,
	}

	// 从 URL 中提取 hostname 用于 SNI
	if redisURL != "" {
		parsed, err := url.Parse(redisURL)
		if err == nil && parsed.Hostname() != "" {
			tlsConfig.ServerName = parsed.Hostname()
		}
	}

	return tlsConfig
}

// buildRedisOptions 根据配置构建 Redis 连接选项
// 与 Node.js 版本的 buildRedisOptionsForUrl 函数功能对齐
func buildRedisOptions(cfg config.RedisConfig) (*redis.Options, bool, error) {
	var opts *redis.Options
	var useTLS bool

	// 优先使用 URL 方式
	if cfg.URL != "" {
		var err error
		opts, err = parseRedisURL(cfg.URL)
		if err != nil {
			return nil, false, err
		}
		useTLS = isTLSEnabled(cfg.URL)

		// 如果使用 TLS，配置 TLS 选项
		if useTLS {
			opts.TLSConfig = buildTLSConfig(cfg.URL, cfg.TLSRejectUnauthorized)
		}
	} else {
		// 使用 Host:Port 方式
		port := cfg.Port
		if port == 0 {
			port = 6379
		}

		opts = &redis.Options{
			Addr:     fmt.Sprintf("%s:%d", cfg.Host, port),
			Password: cfg.Password,
			DB:       cfg.DB,
		}
	}

	// 应用连接池配置
	if cfg.PoolSize > 0 {
		opts.PoolSize = cfg.PoolSize
	} else if opts.PoolSize == 0 {
		opts.PoolSize = defaultPoolSize
	}

	if cfg.MinIdleConns > 0 {
		opts.MinIdleConns = cfg.MinIdleConns
	} else if opts.MinIdleConns == 0 {
		opts.MinIdleConns = defaultMinIdleConns
	}

	// 应用超时配置
	if cfg.DialTimeout > 0 {
		opts.DialTimeout = cfg.DialTimeout
	} else if opts.DialTimeout == 0 {
		opts.DialTimeout = defaultDialTimeout
	}

	if cfg.ReadTimeout > 0 {
		opts.ReadTimeout = cfg.ReadTimeout
	} else if opts.ReadTimeout == 0 {
		opts.ReadTimeout = defaultReadTimeout
	}

	if cfg.WriteTimeout > 0 {
		opts.WriteTimeout = cfg.WriteTimeout
	} else if opts.WriteTimeout == 0 {
		opts.WriteTimeout = defaultWriteTimeout
	}

	// 应用重试配置（与 Node.js 版本对齐）
	if cfg.MaxRetries > 0 {
		opts.MaxRetries = cfg.MaxRetries
	} else {
		opts.MaxRetries = defaultMaxRetries
	}

	if cfg.MinRetryBackoff > 0 {
		opts.MinRetryBackoff = cfg.MinRetryBackoff
	} else {
		opts.MinRetryBackoff = defaultMinRetryBackoff
	}

	if cfg.MaxRetryBackoff > 0 {
		opts.MaxRetryBackoff = cfg.MaxRetryBackoff
	} else {
		opts.MaxRetryBackoff = defaultMaxRetryBackoff
	}

	// 禁用离线队列，实现快速失败（与 Node.js 版本的 enableOfflineQueue: false 对齐）
	// go-redis 默认不使用离线队列，但我们显式设置 PoolTimeout 来实现快速失败
	opts.PoolTimeout = opts.ReadTimeout

	return opts, useTLS, nil
}

// RedisClient 封装 Redis 客户端，提供额外的功能
type RedisClient struct {
	*redis.Client
	useTLS  bool
	safeURL string // 脱敏后的 URL
}

// NewRedis 创建 Redis 客户端
// 与 Node.js 版本的 getRedisClient 函数功能对齐
// 支持 URL 和 Host:Port 两种配置方式，自动检测 TLS
func NewRedis(cfg config.RedisConfig) (*RedisClient, error) {
	// 检查是否启用 Redis
	if !cfg.Enabled {
		logger.Warn().Msg("[Redis] Redis disabled (enabled=false)")
		return nil, nil
	}

	// 检查配置是否有效
	if cfg.URL == "" && cfg.Host == "" {
		logger.Warn().Msg("[Redis] Redis URL or Host not configured")
		return nil, nil
	}

	// 获取脱敏后的 URL 用于日志
	safeURL := ""
	if cfg.URL != "" {
		safeURL = maskRedisURL(cfg.URL)
	} else {
		safeURL = fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	}

	// 构建连接选项
	opts, useTLS, err := buildRedisOptions(cfg)
	if err != nil {
		logger.Error().
			Err(err).
			Str("redisUrl", safeURL).
			Msg("[Redis] Failed to build options")
		return nil, err
	}

	// 记录 TLS 配置信息
	if useTLS {
		logger.Info().
			Str("redisUrl", safeURL).
			Bool("rejectUnauthorized", cfg.TLSRejectUnauthorized).
			Msg("[Redis] Using TLS connection (rediss://)")
	}

	// 创建客户端
	client := redis.NewClient(opts)

	// 测试连接
	ctx, cancel := context.WithTimeout(context.Background(), opts.DialTimeout)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		logger.Error().
			Err(err).
			Str("protocol", protocolName(useTLS)).
			Bool("tlsEnabled", useTLS).
			Str("redisUrl", safeURL).
			Msg("[Redis] Connection error")
		return nil, fmt.Errorf("failed to ping redis: %w", err)
	}

	// 连接成功日志（与 Node.js 版本对齐）
	logger.Info().
		Str("protocol", protocolName(useTLS)).
		Bool("tlsEnabled", useTLS).
		Str("redisUrl", safeURL).
		Int("poolSize", opts.PoolSize).
		Int("minIdleConns", opts.MinIdleConns).
		Int("maxRetries", opts.MaxRetries).
		Msg("[Redis] Connected successfully")

	return &RedisClient{
		Client:  client,
		useTLS:  useTLS,
		safeURL: safeURL,
	}, nil
}

// protocolName 返回协议名称
func protocolName(useTLS bool) string {
	if useTLS {
		return "rediss"
	}
	return "redis"
}

// HealthCheck 执行健康检查
func (c *RedisClient) HealthCheck(ctx context.Context) error {
	if c == nil || c.Client == nil {
		return fmt.Errorf("redis client is nil")
	}

	start := time.Now()
	err := c.Client.Ping(ctx).Err()
	latency := time.Since(start)

	if err != nil {
		logger.Error().
			Err(err).
			Str("redisUrl", c.safeURL).
			Dur("latency", latency).
			Msg("[Redis] Health check failed")
		return err
	}

	logger.Debug().
		Str("redisUrl", c.safeURL).
		Dur("latency", latency).
		Msg("[Redis] Health check passed")

	return nil
}

// GetPoolStats 获取连接池统计信息
func (c *RedisClient) GetPoolStats() *redis.PoolStats {
	if c == nil || c.Client == nil {
		return nil
	}
	return c.Client.PoolStats()
}

// CloseRedis 关闭 Redis 连接
// 与 Node.js 版本的 closeRedis 函数功能对齐
func CloseRedis(client *RedisClient) error {
	if client == nil || client.Client == nil {
		return nil
	}

	logger.Info().
		Str("redisUrl", client.safeURL).
		Msg("[Redis] Closing connection")

	if err := client.Client.Close(); err != nil {
		logger.Error().
			Err(err).
			Str("redisUrl", client.safeURL).
			Msg("[Redis] Failed to close connection")
		return err
	}

	logger.Info().
		Str("redisUrl", client.safeURL).
		Msg("[Redis] Connection closed")

	return nil
}

// GetRedisClient 获取 Redis 客户端（兼容旧接口）
// 返回底层的 *redis.Client
func (c *RedisClient) GetRedisClient() *redis.Client {
	if c == nil {
		return nil
	}
	return c.Client
}

// ParseRedisInfo 解析 Redis INFO 命令的输出
func ParseRedisInfo(info string) map[string]string {
	result := make(map[string]string)
	lines := strings.Split(info, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) == 2 {
			result[parts[0]] = parts[1]
		}
	}
	return result
}

// GetRedisVersion 获取 Redis 服务器版本
func (c *RedisClient) GetRedisVersion(ctx context.Context) (string, error) {
	if c == nil || c.Client == nil {
		return "", fmt.Errorf("redis client is nil")
	}

	info, err := c.Client.Info(ctx, "server").Result()
	if err != nil {
		return "", err
	}

	parsed := ParseRedisInfo(info)
	if version, ok := parsed["redis_version"]; ok {
		return version, nil
	}

	return "", fmt.Errorf("redis_version not found in INFO output")
}

// GetMemoryUsage 获取 Redis 内存使用情况
func (c *RedisClient) GetMemoryUsage(ctx context.Context) (int64, error) {
	if c == nil || c.Client == nil {
		return 0, fmt.Errorf("redis client is nil")
	}

	info, err := c.Client.Info(ctx, "memory").Result()
	if err != nil {
		return 0, err
	}

	parsed := ParseRedisInfo(info)
	if usedMemory, ok := parsed["used_memory"]; ok {
		return strconv.ParseInt(usedMemory, 10, 64)
	}

	return 0, fmt.Errorf("used_memory not found in INFO output")
}

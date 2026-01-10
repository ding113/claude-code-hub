package config

import "time"

// Config 应用配置
type Config struct {
	// Env: 环境模式 (development, production, test)
	Env string `mapstructure:"env"`

	Server         ServerConfig         `mapstructure:"server"`
	Database       DatabaseConfig       `mapstructure:"database"`
	Redis          RedisConfig          `mapstructure:"redis"`
	Log            LogConfig            `mapstructure:"log"`
	Auth           AuthConfig           `mapstructure:"auth"`
	MessageRequest MessageRequestConfig `mapstructure:"message_request"`
	Features       FeaturesConfig       `mapstructure:"features"`
	Proxy          ProxyConfig          `mapstructure:"proxy"`
	Session        SessionConfig        `mapstructure:"session"`
	SmartProbing   SmartProbingConfig   `mapstructure:"smart_probing"`
	APITest        APITestConfig        `mapstructure:"api_test"`
	App            AppConfig            `mapstructure:"app"`

	// Timezone: 时区，默认 Asia/Shanghai
	Timezone string `mapstructure:"timezone"`

	// DebugMode: 调试模式
	DebugMode bool `mapstructure:"debug_mode"`

	// AutoMigrate: 自动迁移数据库
	AutoMigrate bool `mapstructure:"auto_migrate"`
}

// ServerConfig 服务器配置
type ServerConfig struct {
	Port            int           `mapstructure:"port"`
	Host            string        `mapstructure:"host"`
	ReadTimeout     time.Duration `mapstructure:"read_timeout"`
	WriteTimeout    time.Duration `mapstructure:"write_timeout"`
	ShutdownTimeout time.Duration `mapstructure:"shutdown_timeout"`
}

// DatabaseConfig 数据库配置
// 支持两种配置方式：
// 1. DSN 连接字符串（优先）
// 2. 分离的配置字段（Host, Port, User, Password, DBName, SSLMode）
type DatabaseConfig struct {
	// DSN 连接字符串，格式：postgres://user:password@host:port/dbname?sslmode=disable
	// 如果设置了 DSN，则忽略 Host, Port, User, Password, DBName, SSLMode 字段
	DSN string `mapstructure:"dsn"`

	// 分离的配置字段（当 DSN 为空时使用）
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	User     string `mapstructure:"user"`
	Password string `mapstructure:"password"`
	DBName   string `mapstructure:"dbname"`
	SSLMode  string `mapstructure:"sslmode"`

	// 连接池配置
	// PoolMax: 最大打开连接数
	// - 多副本部署（k8s）需要结合数据库 max_connections 分摊配置
	// - 范围: 1-200
	PoolMax int `mapstructure:"pool_max"`

	// MaxIdleConns: 最大空闲连接数
	MaxIdleConns int `mapstructure:"max_idle_conns"`

	// IdleTimeout: 空闲连接回收时间（秒）
	// - 范围: 0-3600
	IdleTimeout time.Duration `mapstructure:"idle_timeout"`

	// ConnectTimeout: 建立连接超时时间（秒）
	// - 范围: 1-120
	ConnectTimeout time.Duration `mapstructure:"connect_timeout"`

	// ConnMaxLifetime: 连接最大生命周期
	ConnMaxLifetime time.Duration `mapstructure:"conn_max_lifetime"`
}

// RedisConfig Redis配置
// 支持两种配置方式：
// 1. URL 连接字符串（优先）- 支持 redis:// 和 rediss:// (TLS) 协议
// 2. 分离的配置字段（Host, Port, Password, DB）
type RedisConfig struct {
	// URL 连接方式 (优先级高于 Host:Port)
	// 支持 redis:// 和 rediss:// (TLS) 协议
	URL string `mapstructure:"url"`

	// Host:Port 连接方式 (当 URL 为空时使用)
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	Password string `mapstructure:"password"`
	DB       int    `mapstructure:"db"`

	// 连接池配置
	PoolSize     int           `mapstructure:"pool_size"`
	MinIdleConns int           `mapstructure:"min_idle_conns"`
	DialTimeout  time.Duration `mapstructure:"dial_timeout"`
	ReadTimeout  time.Duration `mapstructure:"read_timeout"`
	WriteTimeout time.Duration `mapstructure:"write_timeout"`

	// TLS 配置
	// TLSRejectUnauthorized: 是否验证 TLS 证书
	// - 默认 true，生产环境建议保持 true
	// - 设置为 false 可跳过证书验证（仅用于测试环境）
	TLSRejectUnauthorized bool `mapstructure:"tls_reject_unauthorized"`

	// 重试配置
	// MaxRetries: 每个请求的最大重试次数，默认 3
	MaxRetries int `mapstructure:"max_retries"`
	// MinRetryBackoff: 最小重试间隔，默认 200ms
	MinRetryBackoff time.Duration `mapstructure:"min_retry_backoff"`
	// MaxRetryBackoff: 最大重试间隔，默认 2s
	MaxRetryBackoff time.Duration `mapstructure:"max_retry_backoff"`

	// 功能开关
	// Enabled: 是否启用 Redis
	Enabled bool `mapstructure:"enabled"`
}

// LogConfig 日志配置
type LogConfig struct {
	// Level: 日志级别 (fatal, error, warn, info, debug, trace)
	Level string `mapstructure:"level"`
	// Format: 日志格式 (json, text)
	Format string `mapstructure:"format"`
}

// AuthConfig 认证配置
type AuthConfig struct {
	// AdminToken: 管理员令牌
	// 用于访问管理 API
	AdminToken string `mapstructure:"admin_token"`
}

// MessageRequestConfig 消息请求配置
type MessageRequestConfig struct {
	// WriteMode: 写入模式
	// - sync: 同步写入（兼容旧行为，但高并发下会增加请求尾部阻塞）
	// - async: 异步批量写入（默认，降低 DB 写放大与连接占用）
	WriteMode string `mapstructure:"write_mode"`

	// AsyncFlushIntervalMs: 异步批量写入刷新间隔（毫秒）
	// - 范围: 10-60000
	AsyncFlushIntervalMs int `mapstructure:"async_flush_interval_ms"`

	// AsyncBatchSize: 异步批量写入批量大小
	// - 范围: 1-2000
	AsyncBatchSize int `mapstructure:"async_batch_size"`

	// AsyncMaxPending: 异步批量写入最大待处理数
	// - 范围: 100-200000
	AsyncMaxPending int `mapstructure:"async_max_pending"`
}

// FeaturesConfig 功能开关配置
type FeaturesConfig struct {
	// EnableRateLimit: 启用限流
	EnableRateLimit bool `mapstructure:"enable_rate_limit"`

	// EnableSecureCookies: 启用安全Cookie
	EnableSecureCookies bool `mapstructure:"enable_secure_cookies"`

	// EnableMultiProviderTypes: 启用多供应商类型
	EnableMultiProviderTypes bool `mapstructure:"enable_multi_provider_types"`

	// EnableCircuitBreakerOnNetworkErrors: 网络错误时启用熔断器
	EnableCircuitBreakerOnNetworkErrors bool `mapstructure:"enable_circuit_breaker_on_network_errors"`

	// EnableProviderCache: 启用供应商缓存
	// - true (默认): 启用进程级缓存，30s TTL，提升供应商查询性能
	// - false: 禁用缓存，每次请求直接查询数据库
	EnableProviderCache bool `mapstructure:"enable_provider_cache"`

	// EnableSmartProbing: 启用智能探测
	// - false (默认): 禁用智能探测
	// - true: 当熔断器处于 OPEN 状态时，定期探测供应商以实现更快恢复
	EnableSmartProbing bool `mapstructure:"enable_smart_probing"`
}

// ProxyConfig 代理配置
type ProxyConfig struct {
	// MaxRetryAttemptsDefault: 默认最大重试次数
	// - 范围: 1-10
	MaxRetryAttemptsDefault int `mapstructure:"max_retry_attempts_default"`

	// FetchBodyTimeout: 请求/响应体传输超时
	// - 默认 600 秒
	FetchBodyTimeout time.Duration `mapstructure:"fetch_body_timeout"`

	// FetchHeadersTimeout: 响应头接收超时
	// - 默认 600 秒
	FetchHeadersTimeout time.Duration `mapstructure:"fetch_headers_timeout"`

	// FetchConnectTimeout: TCP 连接建立超时
	// - 默认 30 秒
	FetchConnectTimeout time.Duration `mapstructure:"fetch_connect_timeout"`
}

// SessionConfig 会话配置
type SessionConfig struct {
	// TTL: 会话 TTL（秒）
	TTL int `mapstructure:"ttl"`

	// StoreSessionMessages: 是否存储请求 messages 到 Redis
	// - false (默认): 不存储
	// - true: 存储（用于实时监控页面查看详情，会增加 Redis 内存使用）
	StoreSessionMessages bool `mapstructure:"store_session_messages"`
}

// SmartProbingConfig 智能探测配置
type SmartProbingConfig struct {
	// IntervalMs: 探测周期间隔（毫秒）
	// - 默认 30000（30秒）
	IntervalMs int `mapstructure:"interval_ms"`

	// TimeoutMs: 单次探测超时时间（毫秒）
	// - 默认 5000（5秒）
	TimeoutMs int `mapstructure:"timeout_ms"`
}

// APITestConfig API 测试配置
type APITestConfig struct {
	// TimeoutMs: API 测试请求超时时间（毫秒）
	// - 范围: 5000-120000
	// - 默认 15000
	TimeoutMs int `mapstructure:"timeout_ms"`
}

// AppConfig 应用配置
type AppConfig struct {
	// URL: 应用访问地址
	// - 留空自动检测
	// - 生产环境建议显式配置，如 https://your-domain.com
	URL string `mapstructure:"url"`
}

// IsDevelopment 检查是否为开发环境
func (c *Config) IsDevelopment() bool {
	return c.Env == "development"
}

// IsProduction 检查是否为生产环境
func (c *Config) IsProduction() bool {
	return c.Env == "production"
}

// IsTest 检查是否为测试环境
func (c *Config) IsTest() bool {
	return c.Env == "test"
}

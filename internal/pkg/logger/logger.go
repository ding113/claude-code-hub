package logger

import (
	"io"
	"os"
	"time"

	"github.com/rs/zerolog"
)

var (
	// Log 全局日志实例
	Log zerolog.Logger
)

// Config 日志配置
type Config struct {
	Level  string // debug, info, warn, error
	Format string // json, text
}

// Init 初始化日志
func Init(cfg Config) {
	// 设置时间格式
	zerolog.TimeFieldFormat = time.RFC3339Nano

	// 解析日志级别
	level, err := zerolog.ParseLevel(cfg.Level)
	if err != nil {
		level = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(level)

	// 选择输出格式
	var writer io.Writer
	if cfg.Format == "text" {
		writer = zerolog.ConsoleWriter{
			Out:        os.Stdout,
			TimeFormat: "2006-01-02 15:04:05.000",
		}
	} else {
		writer = os.Stdout
	}

	// 创建日志实例
	Log = zerolog.New(writer).
		With().
		Timestamp().
		Caller().
		Logger()
}

// Debug 返回 debug 级别的事件
func Debug() *zerolog.Event {
	return Log.Debug()
}

// Info 返回 info 级别的事件
func Info() *zerolog.Event {
	return Log.Info()
}

// Warn 返回 warn 级别的事件
func Warn() *zerolog.Event {
	return Log.Warn()
}

// Error 返回 error 级别的事件
func Error() *zerolog.Event {
	return Log.Error()
}

// Fatal 返回 fatal 级别的事件
func Fatal() *zerolog.Event {
	return Log.Fatal()
}

// With 创建带有额外字段的子日志
func With() zerolog.Context {
	return Log.With()
}

// WithRequestID 创建带有请求 ID 的日志
func WithRequestID(requestID string) zerolog.Logger {
	return Log.With().Str("request_id", requestID).Logger()
}

// WithKeyID 创建带有 Key ID 的日志
func WithKeyID(keyID int) zerolog.Logger {
	return Log.With().Int("key_id", keyID).Logger()
}

// WithProviderID 创建带有 Provider ID 的日志
func WithProviderID(providerID int) zerolog.Logger {
	return Log.With().Int("provider_id", providerID).Logger()
}

// WithContext 创建带有多个上下文字段的日志
func WithContext(fields map[string]interface{}) zerolog.Logger {
	ctx := Log.With()
	for k, v := range fields {
		ctx = ctx.Interface(k, v)
	}
	return ctx.Logger()
}

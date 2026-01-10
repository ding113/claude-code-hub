package logger

import (
	"io"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"
)

// LogLevel 日志级别类型
type LogLevel string

const (
	LevelFatal LogLevel = "fatal"
	LevelError LogLevel = "error"
	LevelWarn  LogLevel = "warn"
	LevelInfo  LogLevel = "info"
	LevelDebug LogLevel = "debug"
	LevelTrace LogLevel = "trace"
)

// levelPriority 日志级别优先级（与 Node.js 版本一致）
var levelPriority = map[LogLevel]int{
	LevelTrace: 10,
	LevelDebug: 20,
	LevelInfo:  30,
	LevelWarn:  40,
	LevelError: 50,
	LevelFatal: 60,
}

// validLevels 有效的日志级别列表
var validLevels = []LogLevel{LevelFatal, LevelError, LevelWarn, LevelInfo, LevelDebug, LevelTrace}

var (
	// Log 全局日志实例
	Log zerolog.Logger
	// currentLevel 当前日志级别
	currentLevel LogLevel
	// mu 保护日志级别的互斥锁
	mu sync.RWMutex
)

// Config 日志配置
type Config struct {
	Level       string // fatal, error, warn, info, debug, trace
	Format      string // json, text
	Development bool   // 是否为开发环境
	DebugMode   bool   // 向后兼容：DEBUG_MODE 环境变量
}

// isValidLevel 检查日志级别是否有效
func isValidLevel(level string) bool {
	for _, l := range validLevels {
		if string(l) == level {
			return true
		}
	}
	return false
}

// getInitialLogLevel 获取初始日志级别
// - 优先使用配置的 Level
// - 向后兼容：如果设置了 DebugMode，使用 debug 级别
// - 开发环境默认 debug
// - 生产环境默认 info
func getInitialLogLevel(cfg Config) LogLevel {
	// 优先使用配置的日志级别
	envLevel := strings.ToLower(cfg.Level)
	if envLevel != "" && isValidLevel(envLevel) {
		return LogLevel(envLevel)
	}

	// 向后兼容：如果设置了 DEBUG_MODE，使用 debug 级别
	if cfg.DebugMode {
		return LevelDebug
	}

	// 开发环境默认 debug，生产环境默认 info
	if cfg.Development {
		return LevelDebug
	}
	return LevelInfo
}

// logLevelToZerolog 将 LogLevel 转换为 zerolog.Level
func logLevelToZerolog(level LogLevel) zerolog.Level {
	switch level {
	case LevelTrace:
		return zerolog.TraceLevel
	case LevelDebug:
		return zerolog.DebugLevel
	case LevelInfo:
		return zerolog.InfoLevel
	case LevelWarn:
		return zerolog.WarnLevel
	case LevelError:
		return zerolog.ErrorLevel
	case LevelFatal:
		return zerolog.FatalLevel
	default:
		return zerolog.InfoLevel
	}
}

// Init 初始化日志
func Init(cfg Config) {
	// 获取初始日志级别
	initialLevel := getInitialLogLevel(cfg)
	mu.Lock()
	currentLevel = initialLevel
	mu.Unlock()

	// 设置 zerolog 全局级别
	zerolog.SetGlobalLevel(logLevelToZerolog(initialLevel))

	// 选择输出格式
	var writer io.Writer

	// 开发环境使用美化输出（类似 pino-pretty）
	if cfg.Format == "text" || cfg.Development {
		writer = zerolog.ConsoleWriter{
			Out:        os.Stdout,
			TimeFormat: "2006-01-02 15:04:05", // 类似 pino-pretty 的 SYS:standard
			NoColor:    false,                 // 启用颜色（colorize: true）
			// 格式化函数：level 输出为标签字符串
			FormatLevel: func(i interface{}) string {
				if ll, ok := i.(string); ok {
					return strings.ToUpper(ll)
				}
				return "???"
			},
		}
	} else {
		// 生产环境使用 JSON 格式
		writer = os.Stdout
	}

	// 设置时间格式为 ISO 8601（与 pino 的 stdTimeFunctions.isoTime 一致）
	zerolog.TimeFieldFormat = time.RFC3339

	// 创建日志实例
	// 注意：不添加 pid 和 hostname（与 Node.js 版本一致：ignore: "pid,hostname"）
	Log = zerolog.New(writer).
		With().
		Timestamp().
		Logger()
}

// SetLogLevel 运行时动态调整日志级别
func SetLogLevel(newLevel LogLevel) {
	if !isValidLevel(string(newLevel)) {
		return
	}

	mu.Lock()
	currentLevel = newLevel
	mu.Unlock()

	zerolog.SetGlobalLevel(logLevelToZerolog(newLevel))
	Log.Info().Msgf("日志级别已调整为: %s", newLevel)
}

// GetLogLevel 获取当前日志级别
func GetLogLevel() LogLevel {
	mu.RLock()
	defer mu.RUnlock()
	return currentLevel
}

// Trace 返回 trace 级别的事件
func Trace() *zerolog.Event {
	return Log.Trace()
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

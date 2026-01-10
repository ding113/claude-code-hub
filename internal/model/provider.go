package model

import (
	"time"

	"github.com/quagmt/udecimal"
	"github.com/uptrace/bun"
)

// Provider 供应商模型
type Provider struct {
	bun.BaseModel `bun:"table:providers,alias:p"`

	ID          int     `bun:"id,pk,autoincrement" json:"id"`
	Name        string  `bun:"name,notnull" json:"name"`
	Description *string `bun:"description" json:"description"`
	URL         string  `bun:"url,notnull" json:"url"`
	Key         string  `bun:"key,notnull" json:"-"` // 不序列化
	IsEnabled   bool    `bun:"is_enabled,notnull,default:true" json:"isEnabled"`
	Weight      int     `bun:"weight,notnull,default:1" json:"weight"`

	// 优先级和分组配置
	Priority       int              `bun:"priority,notnull,default:0" json:"priority"`
	CostMultiplier udecimal.Decimal `bun:"cost_multiplier,type:numeric(10,4),default:1.0" json:"costMultiplier"`
	GroupTag       *string          `bun:"group_tag" json:"groupTag"`

	// 供应商类型
	ProviderType     string `bun:"provider_type,notnull,default:'claude'" json:"providerType"` // claude, claude-auth, codex, gemini-cli, gemini, openai-compatible
	PreserveClientIp bool   `bun:"preserve_client_ip,notnull,default:false" json:"preserveClientIp"`

	// 模型重定向
	ModelRedirects map[string]string `bun:"model_redirects,type:jsonb" json:"modelRedirects"`
	AllowedModels  []string          `bun:"allowed_models,type:jsonb" json:"allowedModels"`
	JoinClaudePool bool              `bun:"join_claude_pool,default:false" json:"joinClaudePool"`

	// Codex instructions 策略（已废弃但保留兼容）
	CodexInstructionsStrategy *string `bun:"codex_instructions_strategy,default:'auto'" json:"codexInstructionsStrategy"` // auto, force_official, keep_original

	// MCP 透传配置
	McpPassthroughType string  `bun:"mcp_passthrough_type,notnull,default:'none'" json:"mcpPassthroughType"` // none, minimax, glm, custom
	McpPassthroughUrl  *string `bun:"mcp_passthrough_url" json:"mcpPassthroughUrl"`

	// 金额限流配置
	Limit5hUSD              udecimal.Decimal `bun:"limit_5h_usd,type:numeric(10,2)" json:"limit5hUsd"`
	LimitDailyUSD           udecimal.Decimal `bun:"limit_daily_usd,type:numeric(10,2)" json:"limitDailyUsd"`
	DailyResetMode          string           `bun:"daily_reset_mode,notnull,default:'fixed'" json:"dailyResetMode"` // fixed, rolling
	DailyResetTime          string           `bun:"daily_reset_time,notnull,default:'00:00'" json:"dailyResetTime"` // HH:mm 格式
	LimitWeeklyUSD          udecimal.Decimal `bun:"limit_weekly_usd,type:numeric(10,2)" json:"limitWeeklyUsd"`
	LimitMonthlyUSD         udecimal.Decimal `bun:"limit_monthly_usd,type:numeric(10,2)" json:"limitMonthlyUsd"`
	LimitTotalUSD           udecimal.Decimal `bun:"limit_total_usd,type:numeric(10,2)" json:"limitTotalUsd"`
	TotalCostResetAt        *time.Time       `bun:"total_cost_reset_at" json:"totalCostResetAt"`
	LimitConcurrentSessions *int             `bun:"limit_concurrent_sessions,default:0" json:"limitConcurrentSessions"`

	// 熔断器配置
	MaxRetryAttempts                       *int `bun:"max_retry_attempts" json:"maxRetryAttempts"`
	CircuitBreakerFailureThreshold         int  `bun:"circuit_breaker_failure_threshold,default:5" json:"circuitBreakerFailureThreshold"`
	CircuitBreakerOpenDuration             int  `bun:"circuit_breaker_open_duration,default:1800000" json:"circuitBreakerOpenDuration"` // ms (30分钟)
	CircuitBreakerHalfOpenSuccessThreshold int  `bun:"circuit_breaker_half_open_success_threshold,default:2" json:"circuitBreakerHalfOpenSuccessThreshold"`

	// 代理配置
	ProxyUrl              *string `bun:"proxy_url" json:"proxyUrl"`
	ProxyFallbackToDirect bool    `bun:"proxy_fallback_to_direct,default:false" json:"proxyFallbackToDirect"`

	// 超时配置（毫秒）
	FirstByteTimeoutStreamingMs  int `bun:"first_byte_timeout_streaming_ms,notnull,default:0" json:"firstByteTimeoutStreamingMs"`
	StreamingIdleTimeoutMs       int `bun:"streaming_idle_timeout_ms,notnull,default:0" json:"streamingIdleTimeoutMs"`
	RequestTimeoutNonStreamingMs int `bun:"request_timeout_non_streaming_ms,notnull,default:0" json:"requestTimeoutNonStreamingMs"`

	// 供应商官网
	WebsiteUrl *string `bun:"website_url" json:"websiteUrl"`
	FaviconUrl *string `bun:"favicon_url" json:"faviconUrl"`

	// Cache TTL override
	CacheTtlPreference *string `bun:"cache_ttl_preference" json:"cacheTtlPreference"`

	// 1M Context Window 偏好配置
	Context1mPreference *string `bun:"context_1m_preference" json:"context1mPreference"`

	// Codex 参数覆写
	CodexReasoningEffortPreference   *string `bun:"codex_reasoning_effort_preference" json:"codexReasoningEffortPreference"`
	CodexReasoningSummaryPreference  *string `bun:"codex_reasoning_summary_preference" json:"codexReasoningSummaryPreference"`
	CodexTextVerbosityPreference     *string `bun:"codex_text_verbosity_preference" json:"codexTextVerbosityPreference"`
	CodexParallelToolCallsPreference *string `bun:"codex_parallel_tool_calls_preference" json:"codexParallelToolCallsPreference"`

	// 废弃字段（保留向后兼容）
	Tpm int `bun:"tpm,default:0" json:"tpm"`
	Rpm int `bun:"rpm,default:0" json:"rpm"`
	Rpd int `bun:"rpd,default:0" json:"rpd"`
	Cc  int `bun:"cc,default:0" json:"cc"`

	CreatedAt time.Time  `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
	UpdatedAt time.Time  `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`
	DeletedAt *time.Time `bun:"deleted_at,soft_delete,nullzero" json:"deletedAt,omitempty"`
}

// SupportsModel 检查供应商是否支持指定模型
func (p *Provider) SupportsModel(model string) bool {
	// 如果没有配置允许的模型列表，则支持所有模型
	if len(p.AllowedModels) == 0 {
		return true
	}
	for _, m := range p.AllowedModels {
		if m == model {
			return true
		}
	}
	return false
}

// GetRedirectedModel 获取重定向后的模型名称
func (p *Provider) GetRedirectedModel(model string) string {
	if p.ModelRedirects != nil {
		if redirected, ok := p.ModelRedirects[model]; ok {
			return redirected
		}
	}
	return model
}

// IsActive 检查供应商是否处于活跃状态
func (p *Provider) IsActive() bool {
	return p.IsEnabled && p.DeletedAt == nil
}

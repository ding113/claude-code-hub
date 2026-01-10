package model

// DailyResetMode 日配额重置模式
type DailyResetMode string

const (
	DailyResetModeFixed   DailyResetMode = "fixed"   // 固定时间重置
	DailyResetModeRolling DailyResetMode = "rolling" // 滚动窗口（24小时）
)

// WebhookProviderType Webhook 提供商类型
type WebhookProviderType string

const (
	WebhookProviderTypeWechat   WebhookProviderType = "wechat"
	WebhookProviderTypeFeishu   WebhookProviderType = "feishu"
	WebhookProviderTypeDingtalk WebhookProviderType = "dingtalk"
	WebhookProviderTypeTelegram WebhookProviderType = "telegram"
	WebhookProviderTypeCustom   WebhookProviderType = "custom"
)

// NotificationType 通知类型
type NotificationType string

const (
	NotificationTypeCircuitBreaker   NotificationType = "circuit_breaker"
	NotificationTypeDailyLeaderboard NotificationType = "daily_leaderboard"
	NotificationTypeCostAlert        NotificationType = "cost_alert"
)

// ProviderType 供应商类型
type ProviderType string

const (
	ProviderTypeClaude           ProviderType = "claude"
	ProviderTypeClaudeAuth       ProviderType = "claude-auth"
	ProviderTypeCodex            ProviderType = "codex"
	ProviderTypeGeminiCli        ProviderType = "gemini-cli"
	ProviderTypeGemini           ProviderType = "gemini"
	ProviderTypeOpenAICompatible ProviderType = "openai-compatible"
)

// McpPassthroughType MCP 透传类型
type McpPassthroughType string

const (
	McpPassthroughTypeNone    McpPassthroughType = "none"
	McpPassthroughTypeMinimax McpPassthroughType = "minimax"
	McpPassthroughTypeGlm     McpPassthroughType = "glm"
	McpPassthroughTypeCustom  McpPassthroughType = "custom"
)

// ErrorRuleMatchType 错误规则匹配类型
type ErrorRuleMatchType string

const (
	ErrorRuleMatchTypeRegex    ErrorRuleMatchType = "regex"
	ErrorRuleMatchTypeContains ErrorRuleMatchType = "contains"
	ErrorRuleMatchTypeExact    ErrorRuleMatchType = "exact"
)

// RequestFilterScope 请求过滤器作用域
type RequestFilterScope string

const (
	RequestFilterScopeHeader RequestFilterScope = "header"
	RequestFilterScopeBody   RequestFilterScope = "body"
)

// RequestFilterAction 请求过滤器动作
type RequestFilterAction string

const (
	RequestFilterActionRemove      RequestFilterAction = "remove"
	RequestFilterActionSet         RequestFilterAction = "set"
	RequestFilterActionJsonPath    RequestFilterAction = "json_path"
	RequestFilterActionTextReplace RequestFilterAction = "text_replace"
)

// RequestFilterBindingType 请求过滤器绑定类型
type RequestFilterBindingType string

const (
	RequestFilterBindingTypeGlobal    RequestFilterBindingType = "global"
	RequestFilterBindingTypeProviders RequestFilterBindingType = "providers"
	RequestFilterBindingTypeGroups    RequestFilterBindingType = "groups"
)

// SensitiveWordMatchType 敏感词匹配类型
type SensitiveWordMatchType string

const (
	SensitiveWordMatchTypeContains SensitiveWordMatchType = "contains"
	SensitiveWordMatchTypeExact    SensitiveWordMatchType = "exact"
	SensitiveWordMatchTypeRegex    SensitiveWordMatchType = "regex"
)

// Context1mPreference 1M Context Window 偏好
type Context1mPreference string

const (
	Context1mPreferenceInherit     Context1mPreference = "inherit"
	Context1mPreferenceForceEnable Context1mPreference = "force_enable"
	Context1mPreferenceDisabled    Context1mPreference = "disabled"
)

// CodexInstructionsStrategy Codex instructions 策略
type CodexInstructionsStrategy string

const (
	CodexInstructionsStrategyAuto          CodexInstructionsStrategy = "auto"
	CodexInstructionsStrategyForceOfficial CodexInstructionsStrategy = "force_official"
	CodexInstructionsStrategyKeepOriginal  CodexInstructionsStrategy = "keep_original"
)

// BillingModelSource 计费模型来源
type BillingModelSource string

const (
	BillingModelSourceOriginal   BillingModelSource = "original"   // 重定向前
	BillingModelSourceRedirected BillingModelSource = "redirected" // 重定向后
)

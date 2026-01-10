package model

import (
	"time"

	"github.com/quagmt/udecimal"
	"github.com/uptrace/bun"
)

// ProviderChainItem 供应商链项
type ProviderChainItem struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// SpecialSettingChangeValue 特殊设置变更值
type SpecialSettingChangeValue interface{}

// SpecialSettingChange 特殊设置变更项
type SpecialSettingChange struct {
	Path    string                    `json:"path"`
	Before  SpecialSettingChangeValue `json:"before"`
	After   SpecialSettingChangeValue `json:"after"`
	Changed bool                      `json:"changed"`
}

// SpecialSetting 特殊设置（通用审计字段）
// 用于记录请求在代理链路中发生的"特殊行为/特殊覆写"的命中与生效情况
type SpecialSetting struct {
	Type         string                 `json:"type"`  // provider_parameter_override
	Scope        string                 `json:"scope"` // provider
	ProviderID   *int                   `json:"providerId"`
	ProviderName *string                `json:"providerName"`
	ProviderType *string                `json:"providerType"`
	Hit          bool                   `json:"hit"`
	Changed      bool                   `json:"changed"`
	Changes      []SpecialSettingChange `json:"changes"`
}

// MessageRequest 请求日志模型
type MessageRequest struct {
	bun.BaseModel `bun:"table:message_request,alias:mr"`

	ID         int    `bun:"id,pk,autoincrement" json:"id"`
	ProviderID int    `bun:"provider_id,notnull" json:"providerId"`
	UserID     int    `bun:"user_id,notnull" json:"userId"`
	Key        string `bun:"key,notnull" json:"key"`
	Model      string `bun:"model" json:"model"`
	DurationMs *int   `bun:"duration_ms" json:"durationMs"`

	// 费用 (precision: 21, scale: 15)
	CostUSD udecimal.Decimal `bun:"cost_usd,type:numeric(21,15),default:0" json:"costUsd"`

	// 供应商倍率 (precision: 10, scale: 4)
	CostMultiplier *udecimal.Decimal `bun:"cost_multiplier,type:numeric(10,4)" json:"costMultiplier"`

	// Session ID
	SessionID *string `bun:"session_id" json:"sessionId"`

	// Request Sequence
	RequestSequence int `bun:"request_sequence,default:1" json:"requestSequence"`

	// 上游决策链
	ProviderChain []ProviderChainItem `bun:"provider_chain,type:jsonb" json:"providerChain"`

	// HTTP 状态码
	StatusCode *int `bun:"status_code" json:"statusCode"`

	// API 类型
	ApiType *string `bun:"api_type" json:"apiType"`

	// 请求端点路径
	Endpoint *string `bun:"endpoint" json:"endpoint"`

	// 原始模型名称
	OriginalModel *string `bun:"original_model" json:"originalModel"`

	// Token 使用信息
	InputTokens                *int    `bun:"input_tokens" json:"inputTokens"`
	OutputTokens               *int    `bun:"output_tokens" json:"outputTokens"`
	TtfbMs                     *int    `bun:"ttfb_ms" json:"ttfbMs"`
	CacheCreationInputTokens   *int    `bun:"cache_creation_input_tokens" json:"cacheCreationInputTokens"`
	CacheReadInputTokens       *int    `bun:"cache_read_input_tokens" json:"cacheReadInputTokens"`
	CacheCreation5mInputTokens *int    `bun:"cache_creation_5m_input_tokens" json:"cacheCreation5mInputTokens"`
	CacheCreation1hInputTokens *int    `bun:"cache_creation_1h_input_tokens" json:"cacheCreation1hInputTokens"`
	CacheTtlApplied            *string `bun:"cache_ttl_applied" json:"cacheTtlApplied"`

	// 1M Context Window 应用状态
	Context1mApplied bool `bun:"context_1m_applied,default:false" json:"context1mApplied"`

	// 特殊设置
	SpecialSettings []SpecialSetting `bun:"special_settings,type:jsonb" json:"specialSettings"`

	// 错误信息
	ErrorMessage *string `bun:"error_message" json:"errorMessage"`
	ErrorStack   *string `bun:"error_stack" json:"errorStack"`
	ErrorCause   *string `bun:"error_cause" json:"errorCause"`

	// 拦截原因
	BlockedBy     *string `bun:"blocked_by" json:"blockedBy"`
	BlockedReason *string `bun:"blocked_reason" json:"blockedReason"`

	// User-Agent
	UserAgent *string `bun:"user_agent" json:"userAgent"`

	// Messages 数量
	MessagesCount *int `bun:"messages_count" json:"messagesCount"`

	CreatedAt time.Time  `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
	UpdatedAt time.Time  `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`
	DeletedAt *time.Time `bun:"deleted_at,soft_delete" json:"deletedAt"`

	// 关联
	User     *User     `bun:"rel:belongs-to,join:user_id=id" json:"user,omitempty"`
	Provider *Provider `bun:"rel:belongs-to,join:provider_id=id" json:"provider,omitempty"`
}

// TotalTokens 返回总 token 数
func (m *MessageRequest) TotalTokens() int {
	var total int
	if m.InputTokens != nil {
		total += *m.InputTokens
	}
	if m.OutputTokens != nil {
		total += *m.OutputTokens
	}
	if m.CacheReadInputTokens != nil {
		total += *m.CacheReadInputTokens
	}
	if m.CacheCreationInputTokens != nil {
		total += *m.CacheCreationInputTokens
	}
	return total
}

// IsSuccess 检查请求是否成功
func (m *MessageRequest) IsSuccess() bool {
	if m.StatusCode == nil {
		return false
	}
	return *m.StatusCode >= 200 && *m.StatusCode < 300
}

// IsError 检查请求是否失败
func (m *MessageRequest) IsError() bool {
	if m.StatusCode == nil {
		return false
	}
	return *m.StatusCode >= 400
}

// IsBlocked 检查请求是否被拦截
func (m *MessageRequest) IsBlocked() bool {
	return m.BlockedBy != nil && *m.BlockedBy != ""
}

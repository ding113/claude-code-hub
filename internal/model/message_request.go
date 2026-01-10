package model

import (
	"time"

	"github.com/quagmt/udecimal"
	"github.com/uptrace/bun"
)

// MessageRequest 请求日志模型
type MessageRequest struct {
	bun.BaseModel `bun:"table:message_requests,alias:mr"`

	ID         int    `bun:"id,pk,autoincrement" json:"id"`
	KeyID      int    `bun:"key_id,notnull" json:"keyId"`
	ProviderID int    `bun:"provider_id,notnull" json:"providerId"`
	SessionID  string `bun:"session_id" json:"sessionId"`

	Model            string `bun:"model" json:"model"`
	InputTokens      int    `bun:"input_tokens" json:"inputTokens"`
	OutputTokens     int    `bun:"output_tokens" json:"outputTokens"`
	CacheReadTokens  int    `bun:"cache_read_tokens" json:"cacheReadTokens"`
	CacheWriteTokens int    `bun:"cache_write_tokens" json:"cacheWriteTokens"`

	CostUSD      udecimal.Decimal `bun:"cost_usd,type:numeric(12,6)" json:"costUsd"`
	StatusCode   int              `bun:"status_code" json:"statusCode"`
	LatencyMs    int              `bun:"latency_ms" json:"latencyMs"`
	ErrorMessage *string          `bun:"error_message" json:"errorMessage"`

	// 请求类型
	RequestType string `bun:"request_type" json:"requestType"` // messages, chat, responses

	CreatedAt time.Time `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`

	// 关联
	Key      *Key      `bun:"rel:belongs-to,join:key_id=id" json:"key,omitempty"`
	Provider *Provider `bun:"rel:belongs-to,join:provider_id=id" json:"provider,omitempty"`
}

// TotalTokens 返回总 token 数
func (m *MessageRequest) TotalTokens() int {
	return m.InputTokens + m.OutputTokens + m.CacheReadTokens + m.CacheWriteTokens
}

// IsSuccess 检查请求是否成功
func (m *MessageRequest) IsSuccess() bool {
	return m.StatusCode >= 200 && m.StatusCode < 300
}

// IsError 检查请求是否失败
func (m *MessageRequest) IsError() bool {
	return m.StatusCode >= 400
}

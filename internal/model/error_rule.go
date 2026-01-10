package model

import (
	"time"

	"github.com/uptrace/bun"
)

// ErrorRule 错误规则模型
type ErrorRule struct {
	bun.BaseModel `bun:"table:error_rules,alias:er"`

	ID          int     `bun:"id,pk,autoincrement" json:"id"`
	Pattern     string  `bun:"pattern,notnull" json:"pattern"`
	MatchType   string  `bun:"match_type,notnull,default:'regex'" json:"matchType"` // regex, contains, exact
	Category    string  `bun:"category,notnull" json:"category"`
	Description *string `bun:"description" json:"description"`

	// 覆写响应体（JSONB）：匹配成功时用此响应替换原始错误响应
	// 格式参考 Claude API: { type: "error", error: { type: "...", message: "..." }, request_id?: "..." }
	// null = 不覆写，保留原始错误响应
	OverrideResponse map[string]interface{} `bun:"override_response,type:jsonb" json:"overrideResponse"`

	// 覆写状态码：null = 透传上游状态码
	OverrideStatusCode *int `bun:"override_status_code" json:"overrideStatusCode"`

	IsEnabled bool `bun:"is_enabled,notnull,default:true" json:"isEnabled"`
	IsDefault bool `bun:"is_default,notnull,default:false" json:"isDefault"`
	Priority  int  `bun:"priority,notnull,default:0" json:"priority"`

	CreatedAt time.Time `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
	UpdatedAt time.Time `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`
}

// IsActive 检查错误规则是否处于活跃状态
func (e *ErrorRule) IsActive() bool {
	return e.IsEnabled
}

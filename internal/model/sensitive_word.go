package model

import (
	"time"

	"github.com/uptrace/bun"
)

// SensitiveWord 敏感词模型
type SensitiveWord struct {
	bun.BaseModel `bun:"table:sensitive_words,alias:sw"`

	ID          int     `bun:"id,pk,autoincrement" json:"id"`
	Word        string  `bun:"word,notnull" json:"word"`
	MatchType   string  `bun:"match_type,notnull,default:'contains'" json:"matchType"` // contains, exact, regex
	Description *string `bun:"description" json:"description"`
	IsEnabled   bool    `bun:"is_enabled,notnull,default:true" json:"isEnabled"`

	CreatedAt time.Time `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
	UpdatedAt time.Time `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`
}

// IsActive 检查敏感词是否处于活跃状态
func (s *SensitiveWord) IsActive() bool {
	return s.IsEnabled
}

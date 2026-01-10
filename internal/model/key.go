package model

import (
	"time"

	"github.com/quagmt/udecimal"
	"github.com/uptrace/bun"
)

// Key API Key 模型
type Key struct {
	bun.BaseModel `bun:"table:keys,alias:k"`

	ID        int    `bun:"id,pk,autoincrement" json:"id"`
	UserID    int    `bun:"user_id,notnull" json:"userId"`
	Name      string `bun:"name,notnull" json:"name"`
	KeyHash   string `bun:"key_hash,notnull,unique" json:"-"` // 不序列化
	KeyPrefix string `bun:"key_prefix,notnull" json:"keyPrefix"`

	// 配额 (继承或覆盖 User)
	RPMLimit        *int             `bun:"rpm_limit" json:"rpmLimit"`
	DailyLimitUSD   udecimal.Decimal `bun:"daily_limit_usd,type:numeric(10,4)" json:"dailyLimitUsd"`
	Limit5hUSD      udecimal.Decimal `bun:"limit_5h_usd,type:numeric(10,4)" json:"limit5hUsd"`
	LimitWeeklyUSD  udecimal.Decimal `bun:"limit_weekly_usd,type:numeric(10,4)" json:"limitWeeklyUsd"`
	LimitMonthlyUSD udecimal.Decimal `bun:"limit_monthly_usd,type:numeric(10,4)" json:"limitMonthlyUsd"`

	// 权限
	AllowedClients []string `bun:"allowed_clients,array" json:"allowedClients"`
	AllowedModels  []string `bun:"allowed_models,array" json:"allowedModels"`

	IsEnabled bool       `bun:"is_enabled,notnull,default:true" json:"isEnabled"`
	ExpiresAt *time.Time `bun:"expires_at" json:"expiresAt"`

	CreatedAt time.Time `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
	UpdatedAt time.Time `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`

	// 关联
	User *User `bun:"rel:belongs-to,join:user_id=id" json:"user,omitempty"`
}

// IsExpired 检查 Key 是否已过期
func (k *Key) IsExpired() bool {
	if k.ExpiresAt == nil {
		return false
	}
	return time.Now().After(*k.ExpiresAt)
}

// IsActive 检查 Key 是否处于活跃状态
func (k *Key) IsActive() bool {
	return k.IsEnabled && !k.IsExpired()
}

// GetEffectiveRPMLimit 获取有效的 RPM 限制（Key 优先，否则使用 User 的）
func (k *Key) GetEffectiveRPMLimit(user *User) *int {
	if k.RPMLimit != nil {
		return k.RPMLimit
	}
	if user != nil {
		return user.RPMLimit
	}
	return nil
}

// GetEffectiveDailyLimit 获取有效的日限额
func (k *Key) GetEffectiveDailyLimit(user *User) udecimal.Decimal {
	if !k.DailyLimitUSD.IsZero() {
		return k.DailyLimitUSD
	}
	if user != nil {
		return user.DailyLimitUSD
	}
	return udecimal.Zero
}

// GetEffectiveAllowedModels 获取有效的允许模型列表
func (k *Key) GetEffectiveAllowedModels(user *User) []string {
	if len(k.AllowedModels) > 0 {
		return k.AllowedModels
	}
	if user != nil {
		return user.AllowedModels
	}
	return nil
}

// GetEffectiveAllowedClients 获取有效的允许客户端列表
func (k *Key) GetEffectiveAllowedClients(user *User) []string {
	if len(k.AllowedClients) > 0 {
		return k.AllowedClients
	}
	if user != nil {
		return user.AllowedClients
	}
	return nil
}

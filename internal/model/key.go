package model

import (
	"time"

	"github.com/quagmt/udecimal"
	"github.com/uptrace/bun"
)

// Key API Key 模型
type Key struct {
	bun.BaseModel `bun:"table:keys,alias:k"`

	ID     int    `bun:"id,pk,autoincrement" json:"id"`
	UserID int    `bun:"user_id,notnull" json:"userId"`
	Key    string `bun:"key,notnull" json:"-"` // 完整 key，不序列化到 JSON
	Name   string `bun:"name,notnull" json:"name"`

	// 金额限流配置
	Limit5hUSD      udecimal.Decimal `bun:"limit_5h_usd,type:numeric(10,2)" json:"limit5hUsd"`
	LimitDailyUSD   udecimal.Decimal `bun:"limit_daily_usd,type:numeric(10,2)" json:"limitDailyUsd"`
	LimitWeeklyUSD  udecimal.Decimal `bun:"limit_weekly_usd,type:numeric(10,2)" json:"limitWeeklyUsd"`
	LimitMonthlyUSD udecimal.Decimal `bun:"limit_monthly_usd,type:numeric(10,2)" json:"limitMonthlyUsd"`
	LimitTotalUSD   udecimal.Decimal `bun:"limit_total_usd,type:numeric(10,2)" json:"limitTotalUsd"`

	// 并发控制
	LimitConcurrentSessions *int `bun:"limit_concurrent_sessions,default:0" json:"limitConcurrentSessions"`

	// 日配额重置配置
	DailyResetMode string `bun:"daily_reset_mode,notnull,default:'fixed'" json:"dailyResetMode"` // "fixed" 或 "rolling"
	DailyResetTime string `bun:"daily_reset_time,notnull,default:'00:00'" json:"dailyResetTime"` // HH:mm 格式

	// Provider 配置
	ProviderGroup string `bun:"provider_group,default:'default'" json:"providerGroup"`

	// 缓存配置
	CacheTtlPreference *string `bun:"cache_ttl_preference" json:"cacheTtlPreference"`

	// 权限
	CanLoginWebUi bool `bun:"can_login_web_ui,default:false" json:"canLoginWebUi"`

	IsEnabled bool       `bun:"is_enabled,default:true" json:"isEnabled"`
	ExpiresAt *time.Time `bun:"expires_at" json:"expiresAt"`

	CreatedAt time.Time  `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
	UpdatedAt time.Time  `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`
	DeletedAt *time.Time `bun:"deleted_at,soft_delete" json:"deletedAt"`

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
	return k.IsEnabled && !k.IsExpired() && k.DeletedAt == nil
}

// GetEffectiveDailyLimit 获取有效的日限额
func (k *Key) GetEffectiveDailyLimit(user *User) udecimal.Decimal {
	if !k.LimitDailyUSD.IsZero() {
		return k.LimitDailyUSD
	}
	if user != nil {
		return user.DailyLimitUSD
	}
	return udecimal.Zero
}

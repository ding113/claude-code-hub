package model

import (
	"time"

	"github.com/quagmt/udecimal"
	"github.com/uptrace/bun"
)

// User 用户模型
type User struct {
	bun.BaseModel `bun:"table:users,alias:u"`

	ID          int      `bun:"id,pk,autoincrement" json:"id"`
	Name        string   `bun:"name,notnull" json:"name"`
	Description *string  `bun:"description" json:"description"`
	Role        string   `bun:"role,default:'user'" json:"role"` // admin, user
	Tags        []string `bun:"tags,type:jsonb" json:"tags"`

	// 供应商组
	ProviderGroup *string `bun:"provider_group" json:"providerGroup"`

	// 配额限制
	RPMLimit                *int              `bun:"rpm_limit" json:"rpmLimit"`
	LimitConcurrentSessions *int              `bun:"limit_concurrent_sessions" json:"limitConcurrentSessions"`
	DailyLimitUSD           *udecimal.Decimal `bun:"daily_limit_usd,type:numeric(10,2)" json:"dailyLimitUsd"`
	Limit5hUSD              *udecimal.Decimal `bun:"limit_5h_usd,type:numeric(10,2)" json:"limit5hUsd"`
	LimitWeeklyUSD          *udecimal.Decimal `bun:"limit_weekly_usd,type:numeric(10,2)" json:"limitWeeklyUsd"`
	LimitMonthlyUSD         *udecimal.Decimal `bun:"limit_monthly_usd,type:numeric(10,2)" json:"limitMonthlyUsd"`
	LimitTotalUSD           *udecimal.Decimal `bun:"limit_total_usd,type:numeric(10,2)" json:"limitTotalUsd"`

	// 日配额重置设置
	DailyResetMode string `bun:"daily_reset_mode,notnull,default:'fixed'" json:"dailyResetMode"` // fixed, rolling
	DailyResetTime string `bun:"daily_reset_time,notnull,default:'00:00'" json:"dailyResetTime"` // HH:mm 格式

	// 权限
	AllowedClients []string `bun:"allowed_clients,type:jsonb" json:"allowedClients"`
	AllowedModels  []string `bun:"allowed_models,type:jsonb" json:"allowedModels"`

	// 状态
	IsEnabled *bool      `bun:"is_enabled,notnull,default:true" json:"isEnabled"`
	ExpiresAt *time.Time `bun:"expires_at" json:"expiresAt"`
	DeletedAt *time.Time `bun:"deleted_at,soft_delete" json:"deletedAt"`

	CreatedAt time.Time `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
	UpdatedAt time.Time `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`

	// 关联
	Keys []Key `bun:"rel:has-many,join:id=user_id" json:"keys,omitempty"`
}

// IsExpired 检查用户是否已过期
func (u *User) IsExpired() bool {
	if u.ExpiresAt == nil {
		return false
	}
	return time.Now().After(*u.ExpiresAt)
}

// IsActive 检查用户是否处于活跃状态
func (u *User) IsActive() bool {
	enabled := true
	if u.IsEnabled != nil {
		enabled = *u.IsEnabled
	}
	return enabled && !u.IsExpired() && u.DeletedAt == nil
}

// IsAdmin 检查用户是否是管理员
func (u *User) IsAdmin() bool {
	return u.Role == "admin"
}

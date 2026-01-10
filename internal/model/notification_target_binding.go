package model

import (
	"time"

	"github.com/uptrace/bun"
)

// NotificationTargetBinding 通知目标绑定模型
type NotificationTargetBinding struct {
	bun.BaseModel `bun:"table:notification_target_bindings,alias:ntb"`

	ID               int    `bun:"id,pk,autoincrement" json:"id"`
	NotificationType string `bun:"notification_type,notnull" json:"notificationType"` // circuit_breaker, daily_leaderboard, cost_alert
	TargetID         int    `bun:"target_id,notnull" json:"targetId"`

	IsEnabled bool `bun:"is_enabled,notnull,default:true" json:"isEnabled"`

	// 定时配置覆盖（可选，仅用于定时类通知）
	ScheduleCron     *string `bun:"schedule_cron" json:"scheduleCron"`
	ScheduleTimezone string  `bun:"schedule_timezone,default:'Asia/Shanghai'" json:"scheduleTimezone"`

	// 模板覆盖（可选，主要用于 custom webhook）
	TemplateOverride map[string]interface{} `bun:"template_override,type:jsonb" json:"templateOverride"`

	CreatedAt time.Time `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`

	// 关联
	Target *WebhookTarget `bun:"rel:belongs-to,join:target_id=id" json:"target,omitempty"`
}

// IsActive 检查绑定是否处于活跃状态
func (n *NotificationTargetBinding) IsActive() bool {
	return n.IsEnabled
}

// GetScheduleTimezone 获取时区配置
func (n *NotificationTargetBinding) GetScheduleTimezone() string {
	if n.ScheduleTimezone == "" {
		return "Asia/Shanghai"
	}
	return n.ScheduleTimezone
}

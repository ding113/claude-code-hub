package model

import (
	"time"

	"github.com/quagmt/udecimal"
	"github.com/uptrace/bun"
)

// NotificationSettings 通知设置模型
type NotificationSettings struct {
	bun.BaseModel `bun:"table:notification_settings,alias:ns"`

	ID int `bun:"id,pk,autoincrement" json:"id"`

	// 全局开关
	Enabled bool `bun:"enabled,notnull,default:false" json:"enabled"`

	// 兼容旧配置：默认使用 legacy 字段（单 URL / 自动识别），创建新目标后会切到新模式
	UseLegacyMode bool `bun:"use_legacy_mode,notnull,default:false" json:"useLegacyMode"`

	// 熔断器告警配置
	CircuitBreakerEnabled bool    `bun:"circuit_breaker_enabled,notnull,default:false" json:"circuitBreakerEnabled"`
	CircuitBreakerWebhook *string `bun:"circuit_breaker_webhook" json:"circuitBreakerWebhook"`

	// 每日用户消费排行榜配置
	DailyLeaderboardEnabled bool    `bun:"daily_leaderboard_enabled,notnull,default:false" json:"dailyLeaderboardEnabled"`
	DailyLeaderboardWebhook *string `bun:"daily_leaderboard_webhook" json:"dailyLeaderboardWebhook"`
	DailyLeaderboardTime    string  `bun:"daily_leaderboard_time,default:'09:00'" json:"dailyLeaderboardTime"` // HH:mm 格式
	DailyLeaderboardTopN    *int    `bun:"daily_leaderboard_top_n,default:5" json:"dailyLeaderboardTopN"`      // 显示前 N 名

	// 成本预警配置
	CostAlertEnabled       bool             `bun:"cost_alert_enabled,notnull,default:false" json:"costAlertEnabled"`
	CostAlertWebhook       *string          `bun:"cost_alert_webhook" json:"costAlertWebhook"`
	CostAlertThreshold     udecimal.Decimal `bun:"cost_alert_threshold,type:numeric(5,2),default:0.80" json:"costAlertThreshold"` // 阈值 0-1 (80% = 0.80)
	CostAlertCheckInterval *int             `bun:"cost_alert_check_interval,default:60" json:"costAlertCheckInterval"`            // 检查间隔（分钟）

	CreatedAt time.Time `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
	UpdatedAt time.Time `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`
}

// GetDailyLeaderboardTopN 获取排行榜显示数量
func (n *NotificationSettings) GetDailyLeaderboardTopN() int {
	if n.DailyLeaderboardTopN == nil {
		return 5
	}
	return *n.DailyLeaderboardTopN
}

// GetCostAlertCheckInterval 获取成本预警检查间隔（分钟）
func (n *NotificationSettings) GetCostAlertCheckInterval() int {
	if n.CostAlertCheckInterval == nil {
		return 60
	}
	return *n.CostAlertCheckInterval
}

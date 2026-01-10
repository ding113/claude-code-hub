package model

import (
	"time"

	"github.com/uptrace/bun"
)

// WebhookTestResult Webhook 测试结果
type WebhookTestResult struct {
	Success   bool    `json:"success"`
	Message   *string `json:"message,omitempty"`
	Timestamp string  `json:"timestamp,omitempty"`
}

// WebhookTarget Webhook 目标模型
type WebhookTarget struct {
	bun.BaseModel `bun:"table:webhook_targets,alias:wt"`

	ID           int    `bun:"id,pk,autoincrement" json:"id"`
	Name         string `bun:"name,notnull" json:"name"`
	ProviderType string `bun:"provider_type,notnull" json:"providerType"` // wechat, feishu, dingtalk, telegram, custom

	// 通用配置
	WebhookUrl *string `bun:"webhook_url" json:"webhookUrl"`

	// Telegram 特有配置
	TelegramBotToken *string `bun:"telegram_bot_token" json:"telegramBotToken"`
	TelegramChatId   *string `bun:"telegram_chat_id" json:"telegramChatId"`

	// 钉钉签名配置
	DingtalkSecret *string `bun:"dingtalk_secret" json:"dingtalkSecret"`

	// 自定义 Webhook 配置
	CustomTemplate map[string]interface{} `bun:"custom_template,type:jsonb" json:"customTemplate"`
	CustomHeaders  map[string]interface{} `bun:"custom_headers,type:jsonb" json:"customHeaders"`

	// 代理配置
	ProxyUrl              *string `bun:"proxy_url" json:"proxyUrl"`
	ProxyFallbackToDirect bool    `bun:"proxy_fallback_to_direct,default:false" json:"proxyFallbackToDirect"`

	// 元数据
	IsEnabled      bool               `bun:"is_enabled,notnull,default:true" json:"isEnabled"`
	LastTestAt     *time.Time         `bun:"last_test_at" json:"lastTestAt"`
	LastTestResult *WebhookTestResult `bun:"last_test_result,type:jsonb" json:"lastTestResult"`

	CreatedAt time.Time `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
	UpdatedAt time.Time `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`

	// 关联
	Bindings []NotificationTargetBinding `bun:"rel:has-many,join:id=target_id" json:"bindings,omitempty"`
}

// IsActive 检查 Webhook 目标是否处于活跃状态
func (w *WebhookTarget) IsActive() bool {
	return w.IsEnabled
}

// IsTelegram 检查是否为 Telegram 类型
func (w *WebhookTarget) IsTelegram() bool {
	return w.ProviderType == string(WebhookProviderTypeTelegram)
}

// IsCustom 检查是否为自定义类型
func (w *WebhookTarget) IsCustom() bool {
	return w.ProviderType == string(WebhookProviderTypeCustom)
}

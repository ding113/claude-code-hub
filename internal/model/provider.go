package model

import (
	"time"

	"github.com/quagmt/udecimal"
	"github.com/uptrace/bun"
)

// Provider 供应商模型
type Provider struct {
	bun.BaseModel `bun:"table:providers,alias:p"`

	ID   int    `bun:"id,pk,autoincrement" json:"id"`
	Name string `bun:"name,notnull" json:"name"`
	URL  string `bun:"url,notnull" json:"url"`
	Key  string `bun:"key,notnull" json:"-"` // 不序列化

	ProviderType   string           `bun:"provider_type,notnull" json:"providerType"` // anthropic, openai, azure, google, bedrock
	IsEnabled      bool             `bun:"is_enabled,notnull,default:true" json:"isEnabled"`
	Weight         int              `bun:"weight,notnull,default:1" json:"weight"`
	Priority       int              `bun:"priority,notnull,default:0" json:"priority"`
	CostMultiplier udecimal.Decimal `bun:"cost_multiplier,type:numeric(5,2),default:1.00" json:"costMultiplier"`
	GroupTag       *string          `bun:"group_tag" json:"groupTag"`

	// 限流
	DailyLimitUSD udecimal.Decimal `bun:"daily_limit_usd,type:numeric(10,4)" json:"dailyLimitUsd"`
	SessionLimit  *int             `bun:"session_limit" json:"sessionLimit"`

	// 熔断配置
	FailureThreshold         int `bun:"failure_threshold,default:5" json:"failureThreshold"`
	OpenDuration             int `bun:"open_duration,default:60000" json:"openDuration"` // ms
	HalfOpenSuccessThreshold int `bun:"half_open_success_threshold,default:2" json:"halfOpenSuccessThreshold"`

	// 支持的模型
	SupportedModels []string          `bun:"supported_models,array" json:"supportedModels"`
	ModelMappings   map[string]string `bun:"model_mappings,type:jsonb" json:"modelMappings"`

	CreatedAt time.Time `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
	UpdatedAt time.Time `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`
}

// SupportsModel 检查供应商是否支持指定模型
func (p *Provider) SupportsModel(model string) bool {
	// 如果没有配置支持的模型列表，则支持所有模型
	if len(p.SupportedModels) == 0 {
		return true
	}
	for _, m := range p.SupportedModels {
		if m == model {
			return true
		}
	}
	return false
}

// GetMappedModel 获取映射后的模型名称
func (p *Provider) GetMappedModel(model string) string {
	if p.ModelMappings != nil {
		if mapped, ok := p.ModelMappings[model]; ok {
			return mapped
		}
	}
	return model
}

// IsActive 检查供应商是否处于活跃状态
func (p *Provider) IsActive() bool {
	return p.IsEnabled
}

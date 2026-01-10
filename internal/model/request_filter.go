package model

import (
	"time"

	"github.com/uptrace/bun"
)

// RequestFilter 请求过滤器模型
type RequestFilter struct {
	bun.BaseModel `bun:"table:request_filters,alias:rf"`

	ID          int     `bun:"id,pk,autoincrement" json:"id"`
	Name        string  `bun:"name,notnull" json:"name"`
	Description *string `bun:"description" json:"description"`

	// 作用域：header 或 body
	Scope string `bun:"scope,notnull" json:"scope"` // header, body

	// 动作类型
	Action string `bun:"action,notnull" json:"action"` // remove, set, json_path, text_replace

	// 匹配类型（可选）
	MatchType *string `bun:"match_type" json:"matchType"`

	// 目标（要匹配/操作的字段或路径）
	Target string `bun:"target,notnull" json:"target"`

	// 替换值（JSONB）
	Replacement interface{} `bun:"replacement,type:jsonb" json:"replacement"`

	// 优先级
	Priority int `bun:"priority,notnull,default:0" json:"priority"`

	// 是否启用
	IsEnabled bool `bun:"is_enabled,notnull,default:true" json:"isEnabled"`

	// 绑定类型
	BindingType string `bun:"binding_type,notnull,default:'global'" json:"bindingType"` // global, providers, groups

	// 绑定的供应商 ID 列表
	ProviderIds []int `bun:"provider_ids,type:jsonb" json:"providerIds"`

	// 绑定的分组标签列表
	GroupTags []string `bun:"group_tags,type:jsonb" json:"groupTags"`

	CreatedAt time.Time `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
	UpdatedAt time.Time `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`
}

// IsActive 检查请求过滤器是否处于活跃状态
func (r *RequestFilter) IsActive() bool {
	return r.IsEnabled
}

// IsGlobal 检查是否为全局过滤器
func (r *RequestFilter) IsGlobal() bool {
	return r.BindingType == string(RequestFilterBindingTypeGlobal)
}

// AppliesToProvider 检查过滤器是否适用于指定供应商
func (r *RequestFilter) AppliesToProvider(providerID int, groupTag *string) bool {
	if r.IsGlobal() {
		return true
	}

	if r.BindingType == string(RequestFilterBindingTypeProviders) {
		for _, id := range r.ProviderIds {
			if id == providerID {
				return true
			}
		}
	}

	if r.BindingType == string(RequestFilterBindingTypeGroups) && groupTag != nil {
		for _, tag := range r.GroupTags {
			if tag == *groupTag {
				return true
			}
		}
	}

	return false
}

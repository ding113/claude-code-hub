package model

import (
	"encoding/json"
	"time"

	"github.com/quagmt/udecimal"
	"github.com/uptrace/bun"
)

// SearchContextCostPerQuery 搜索上下文价格
type SearchContextCostPerQuery struct {
	SearchContextSizeHigh   *float64 `json:"search_context_size_high,omitempty"`
	SearchContextSizeLow    *float64 `json:"search_context_size_low,omitempty"`
	SearchContextSizeMedium *float64 `json:"search_context_size_medium,omitempty"`
}

// PriceData 模型价格数据 (与 Node.js 版本完全对应)
// 注意：所有价格字段都是 "每 token" 的价格，不是 "每百万 token"
type PriceData struct {
	// 基础价格信息 (每 token)
	InputCostPerToken  *float64 `json:"input_cost_per_token,omitempty"`
	OutputCostPerToken *float64 `json:"output_cost_per_token,omitempty"`

	// 缓存相关价格
	CacheCreationInputTokenCost        *float64 `json:"cache_creation_input_token_cost,omitempty"`
	CacheCreationInputTokenCostAbove1h *float64 `json:"cache_creation_input_token_cost_above_1hr,omitempty"`
	CacheReadInputTokenCost            *float64 `json:"cache_read_input_token_cost,omitempty"`

	// 200K 分层价格（Gemini 等模型使用）
	InputCostPerTokenAbove200kTokens           *float64 `json:"input_cost_per_token_above_200k_tokens,omitempty"`
	OutputCostPerTokenAbove200kTokens          *float64 `json:"output_cost_per_token_above_200k_tokens,omitempty"`
	CacheCreationInputTokenCostAbove200kTokens *float64 `json:"cache_creation_input_token_cost_above_200k_tokens,omitempty"`
	CacheReadInputTokenCostAbove200kTokens     *float64 `json:"cache_read_input_token_cost_above_200k_tokens,omitempty"`

	// 图片生成价格
	OutputCostPerImage *float64 `json:"output_cost_per_image,omitempty"`

	// 搜索上下文价格
	SearchContextCostPerQuery *SearchContextCostPerQuery `json:"search_context_cost_per_query,omitempty"`

	// 模型能力信息
	LitellmProvider *string `json:"litellm_provider,omitempty"`
	MaxInputTokens  *int    `json:"max_input_tokens,omitempty"`
	MaxOutputTokens *int    `json:"max_output_tokens,omitempty"`
	MaxTokens       *int    `json:"max_tokens,omitempty"`
	Mode            *string `json:"mode,omitempty"` // "chat" | "image_generation" | "completion"

	// 支持的功能
	SupportsAssistantPrefill *bool `json:"supports_assistant_prefill,omitempty"`
	SupportsComputerUse      *bool `json:"supports_computer_use,omitempty"`
	SupportsFunctionCalling  *bool `json:"supports_function_calling,omitempty"`
	SupportsPdfInput         *bool `json:"supports_pdf_input,omitempty"`
	SupportsPromptCaching    *bool `json:"supports_prompt_caching,omitempty"`
	SupportsReasoning        *bool `json:"supports_reasoning,omitempty"`
	SupportsResponseSchema   *bool `json:"supports_response_schema,omitempty"`
	SupportsToolChoice       *bool `json:"supports_tool_choice,omitempty"`
	SupportsVision           *bool `json:"supports_vision,omitempty"`

	// 其他字段
	ToolUseSystemPromptTokens *int `json:"tool_use_system_prompt_tokens,omitempty"`

	// 额外字段（支持 [key: string]: unknown，与 Node.js 版本对齐）
	Extra map[string]interface{} `bun:"-"`
}

// knownPriceDataKeys 已知的 PriceData 字段名（用于分离额外字段）
var knownPriceDataKeys = map[string]bool{
	"input_cost_per_token":                              true,
	"output_cost_per_token":                             true,
	"cache_creation_input_token_cost":                   true,
	"cache_creation_input_token_cost_above_1hr":         true,
	"cache_read_input_token_cost":                       true,
	"input_cost_per_token_above_200k_tokens":            true,
	"output_cost_per_token_above_200k_tokens":           true,
	"cache_creation_input_token_cost_above_200k_tokens": true,
	"cache_read_input_token_cost_above_200k_tokens":     true,
	"output_cost_per_image":                             true,
	"search_context_cost_per_query":                     true,
	"litellm_provider":                                  true,
	"max_input_tokens":                                  true,
	"max_output_tokens":                                 true,
	"max_tokens":                                        true,
	"mode":                                              true,
	"supports_assistant_prefill":                        true,
	"supports_computer_use":                             true,
	"supports_function_calling":                         true,
	"supports_pdf_input":                                true,
	"supports_prompt_caching":                           true,
	"supports_reasoning":                                true,
	"supports_response_schema":                          true,
	"supports_tool_choice":                              true,
	"supports_vision":                                   true,
	"tool_use_system_prompt_tokens":                     true,
}

// UnmarshalJSON 自定义 JSON 反序列化，保留额外字段
func (p *PriceData) UnmarshalJSON(data []byte) error {
	// 使用别名避免递归调用
	type PriceDataAlias PriceData
	alias := (*PriceDataAlias)(p)

	// 先解析已知字段
	if err := json.Unmarshal(data, alias); err != nil {
		return err
	}

	// 解析所有字段到 map
	var allFields map[string]interface{}
	if err := json.Unmarshal(data, &allFields); err != nil {
		return err
	}

	// 提取额外字段
	p.Extra = make(map[string]interface{})
	for key, value := range allFields {
		if !knownPriceDataKeys[key] {
			p.Extra[key] = value
		}
	}

	return nil
}

// MarshalJSON 自定义 JSON 序列化，包含额外字段
func (p PriceData) MarshalJSON() ([]byte, error) {
	// 使用别名避免递归调用
	type PriceDataAlias PriceData
	alias := PriceDataAlias(p)

	// 先序列化已知字段
	knownData, err := json.Marshal(alias)
	if err != nil {
		return nil, err
	}

	// 如果没有额外字段，直接返回
	if len(p.Extra) == 0 {
		return knownData, nil
	}

	// 解析已知字段为 map
	var result map[string]interface{}
	if err := json.Unmarshal(knownData, &result); err != nil {
		return nil, err
	}

	// 合并额外字段
	for key, value := range p.Extra {
		result[key] = value
	}

	return json.Marshal(result)
}

// GetInputCostPerToken 获取输入价格（每 token）
func (p *PriceData) GetInputCostPerToken() float64 {
	if p.InputCostPerToken == nil {
		return 0
	}
	return *p.InputCostPerToken
}

// GetOutputCostPerToken 获取输出价格（每 token）
func (p *PriceData) GetOutputCostPerToken() float64 {
	if p.OutputCostPerToken == nil {
		return 0
	}
	return *p.OutputCostPerToken
}

// GetCacheCreationInputTokenCost 获取缓存创建价格（每 token）
func (p *PriceData) GetCacheCreationInputTokenCost() float64 {
	if p.CacheCreationInputTokenCost == nil {
		return 0
	}
	return *p.CacheCreationInputTokenCost
}

// GetCacheCreationInputTokenCostAbove1h 获取 1 小时以上缓存创建价格（每 token）
func (p *PriceData) GetCacheCreationInputTokenCostAbove1h() float64 {
	if p.CacheCreationInputTokenCostAbove1h == nil {
		return 0
	}
	return *p.CacheCreationInputTokenCostAbove1h
}

// GetCacheReadInputTokenCost 获取缓存读取价格（每 token）
func (p *PriceData) GetCacheReadInputTokenCost() float64 {
	if p.CacheReadInputTokenCost == nil {
		return 0
	}
	return *p.CacheReadInputTokenCost
}

// ModelPrice 模型定价
type ModelPrice struct {
	bun.BaseModel `bun:"table:model_prices,alias:mp"`

	ID        int       `bun:"id,pk,autoincrement" json:"id"`
	ModelName string    `bun:"model_name,notnull" json:"modelName"`
	PriceData PriceData `bun:"price_data,type:jsonb,notnull" json:"priceData"`

	CreatedAt time.Time `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
	UpdatedAt time.Time `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`
}

// CalculateCost 计算请求成本
// 参数为 token 数量，返回 USD 费用
func (m *ModelPrice) CalculateCost(inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens int) (udecimal.Decimal, error) {
	inputCostPerToken := m.PriceData.GetInputCostPerToken()
	outputCostPerToken := m.PriceData.GetOutputCostPerToken()
	cacheReadCostPerToken := m.PriceData.GetCacheReadInputTokenCost()
	cacheWriteCostPerToken := m.PriceData.GetCacheCreationInputTokenCost()

	// 转换为 udecimal 进行高精度计算
	inputCost, _ := udecimal.NewFromFloat64(inputCostPerToken * float64(inputTokens))
	outputCost, _ := udecimal.NewFromFloat64(outputCostPerToken * float64(outputTokens))
	cacheReadCost, _ := udecimal.NewFromFloat64(cacheReadCostPerToken * float64(cacheReadTokens))
	cacheWriteCost, _ := udecimal.NewFromFloat64(cacheWriteCostPerToken * float64(cacheWriteTokens))

	return inputCost.Add(outputCost).Add(cacheReadCost).Add(cacheWriteCost), nil
}

// CalculateCostWithTieredCache 计算请求成本（包含分层缓存 TTL）
// cacheCreationTokens: 默认 TTL 缓存创建 token 数
// cacheCreationAbove1hTokens: 1 小时以上 TTL 缓存创建 token 数
func (m *ModelPrice) CalculateCostWithTieredCache(inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, cacheCreationAbove1hTokens int) (udecimal.Decimal, error) {
	inputCostPerToken := m.PriceData.GetInputCostPerToken()
	outputCostPerToken := m.PriceData.GetOutputCostPerToken()
	cacheReadCostPerToken := m.PriceData.GetCacheReadInputTokenCost()
	cacheCreationCostPerToken := m.PriceData.GetCacheCreationInputTokenCost()
	cacheCreationAbove1hCostPerToken := m.PriceData.GetCacheCreationInputTokenCostAbove1h()

	// 转换为 udecimal 进行高精度计算
	inputCost, _ := udecimal.NewFromFloat64(inputCostPerToken * float64(inputTokens))
	outputCost, _ := udecimal.NewFromFloat64(outputCostPerToken * float64(outputTokens))
	cacheReadCost, _ := udecimal.NewFromFloat64(cacheReadCostPerToken * float64(cacheReadTokens))
	cacheCreationCost, _ := udecimal.NewFromFloat64(cacheCreationCostPerToken * float64(cacheCreationTokens))
	cacheCreationAbove1hCost, _ := udecimal.NewFromFloat64(cacheCreationAbove1hCostPerToken * float64(cacheCreationAbove1hTokens))

	return inputCost.Add(outputCost).Add(cacheReadCost).Add(cacheCreationCost).Add(cacheCreationAbove1hCost), nil
}

// CalculateCostAbove200k 计算 200K 以上 token 的请求成本（Gemini 等模型）
func (m *ModelPrice) CalculateCostAbove200k(inputTokensBelow200k, inputTokensAbove200k, outputTokensBelow200k, outputTokensAbove200k int) (udecimal.Decimal, error) {
	// 基础价格
	inputCostPerToken := m.PriceData.GetInputCostPerToken()
	outputCostPerToken := m.PriceData.GetOutputCostPerToken()

	// 200K 以上价格（如果未设置，使用基础价格）
	inputCostAbove200k := inputCostPerToken
	if m.PriceData.InputCostPerTokenAbove200kTokens != nil {
		inputCostAbove200k = *m.PriceData.InputCostPerTokenAbove200kTokens
	}
	outputCostAbove200k := outputCostPerToken
	if m.PriceData.OutputCostPerTokenAbove200kTokens != nil {
		outputCostAbove200k = *m.PriceData.OutputCostPerTokenAbove200kTokens
	}

	// 计算费用
	inputCostBelow, _ := udecimal.NewFromFloat64(inputCostPerToken * float64(inputTokensBelow200k))
	inputCostAbove, _ := udecimal.NewFromFloat64(inputCostAbove200k * float64(inputTokensAbove200k))
	outputCostBelow, _ := udecimal.NewFromFloat64(outputCostPerToken * float64(outputTokensBelow200k))
	outputCostAbove, _ := udecimal.NewFromFloat64(outputCostAbove200k * float64(outputTokensAbove200k))

	return inputCostBelow.Add(inputCostAbove).Add(outputCostBelow).Add(outputCostAbove), nil
}

// CalculateImageCost 计算图片生成费用
func (m *ModelPrice) CalculateImageCost(imageCount int) (udecimal.Decimal, error) {
	if m.PriceData.OutputCostPerImage == nil {
		return udecimal.Zero, nil
	}
	cost, _ := udecimal.NewFromFloat64(*m.PriceData.OutputCostPerImage * float64(imageCount))
	return cost, nil
}

// SupportsFeature 检查模型是否支持某个功能
func (m *ModelPrice) SupportsFeature(feature string) bool {
	switch feature {
	case "assistant_prefill":
		return m.PriceData.SupportsAssistantPrefill != nil && *m.PriceData.SupportsAssistantPrefill
	case "computer_use":
		return m.PriceData.SupportsComputerUse != nil && *m.PriceData.SupportsComputerUse
	case "function_calling":
		return m.PriceData.SupportsFunctionCalling != nil && *m.PriceData.SupportsFunctionCalling
	case "pdf_input":
		return m.PriceData.SupportsPdfInput != nil && *m.PriceData.SupportsPdfInput
	case "prompt_caching":
		return m.PriceData.SupportsPromptCaching != nil && *m.PriceData.SupportsPromptCaching
	case "reasoning":
		return m.PriceData.SupportsReasoning != nil && *m.PriceData.SupportsReasoning
	case "response_schema":
		return m.PriceData.SupportsResponseSchema != nil && *m.PriceData.SupportsResponseSchema
	case "tool_choice":
		return m.PriceData.SupportsToolChoice != nil && *m.PriceData.SupportsToolChoice
	case "vision":
		return m.PriceData.SupportsVision != nil && *m.PriceData.SupportsVision
	default:
		return false
	}
}

// GetMaxInputTokens 获取最大输入 token 数
func (m *ModelPrice) GetMaxInputTokens() int {
	if m.PriceData.MaxInputTokens != nil {
		return *m.PriceData.MaxInputTokens
	}
	return 0
}

// GetMaxOutputTokens 获取最大输出 token 数
func (m *ModelPrice) GetMaxOutputTokens() int {
	if m.PriceData.MaxOutputTokens != nil {
		return *m.PriceData.MaxOutputTokens
	}
	return 0
}

// GetMode 获取模型模式
func (m *ModelPrice) GetMode() string {
	if m.PriceData.Mode != nil {
		return *m.PriceData.Mode
	}
	return "chat"
}

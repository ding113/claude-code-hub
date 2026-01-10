package model

import (
	"time"

	"github.com/quagmt/udecimal"
	"github.com/uptrace/bun"
)

// ModelPrice 模型定价
type ModelPrice struct {
	bun.BaseModel `bun:"table:model_prices,alias:mp"`

	ID                       int              `bun:"id,pk,autoincrement" json:"id"`
	Model                    string           `bun:"model,notnull,unique" json:"model"`
	InputPricePerMToken      udecimal.Decimal `bun:"input_price_per_m_token,type:numeric(10,6)" json:"inputPricePerMToken"`
	OutputPricePerMToken     udecimal.Decimal `bun:"output_price_per_m_token,type:numeric(10,6)" json:"outputPricePerMToken"`
	CacheReadPricePerMToken  udecimal.Decimal `bun:"cache_read_price_per_m_token,type:numeric(10,6)" json:"cacheReadPricePerMToken"`
	CacheWritePricePerMToken udecimal.Decimal `bun:"cache_write_price_per_m_token,type:numeric(10,6)" json:"cacheWritePricePerMToken"`

	CreatedAt time.Time `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
	UpdatedAt time.Time `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`
}

// CalculateCost 计算请求成本
func (m *ModelPrice) CalculateCost(inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens int) udecimal.Decimal {
	million := udecimal.MustFromInt64(1000000)

	inputCost := m.InputPricePerMToken.Mul(udecimal.MustFromInt64(int64(inputTokens))).Div(million)
	outputCost := m.OutputPricePerMToken.Mul(udecimal.MustFromInt64(int64(outputTokens))).Div(million)
	cacheReadCost := m.CacheReadPricePerMToken.Mul(udecimal.MustFromInt64(int64(cacheReadTokens))).Div(million)
	cacheWriteCost := m.CacheWritePricePerMToken.Mul(udecimal.MustFromInt64(int64(cacheWriteTokens))).Div(million)

	return inputCost.Add(outputCost).Add(cacheReadCost).Add(cacheWriteCost)
}

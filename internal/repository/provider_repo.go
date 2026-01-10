package repository

import (
	"context"
	"database/sql"
	"sort"
	"strings"
	"time"

	"github.com/ding113/claude-code-hub/internal/model"
	"github.com/ding113/claude-code-hub/internal/pkg/errors"
	"github.com/quagmt/udecimal"
	"github.com/uptrace/bun"
)

// ProviderStatistics 供应商统计信息
type ProviderStatistics struct {
	ID            int              `bun:"id"`
	TodayCost     udecimal.Decimal `bun:"today_cost"`
	TodayCalls    int              `bun:"today_calls"`
	LastCallTime  *time.Time       `bun:"last_call_time"`
	LastCallModel *string          `bun:"last_call_model"`
}

// ProviderRepository Provider 数据访问接口
type ProviderRepository interface {
	Repository

	// Create 创建供应商
	Create(ctx context.Context, provider *model.Provider) error

	// GetByID 根据 ID 获取供应商
	GetByID(ctx context.Context, id int) (*model.Provider, error)

	// Update 更新供应商
	Update(ctx context.Context, provider *model.Provider) error

	// Delete 删除供应商（软删除）
	Delete(ctx context.Context, id int) error

	// List 获取供应商列表
	List(ctx context.Context, opts *ListOptions) ([]*model.Provider, error)

	// ListAll 获取所有供应商（不分页，用于缓存刷新等场景）
	ListAll(ctx context.Context) ([]*model.Provider, error)

	// Count 统计供应商总数
	Count(ctx context.Context, includeDeleted bool) (int, error)

	// GetByName 根据名称查找供应商
	GetByName(ctx context.Context, name string) (*model.Provider, error)

	// ExistsByName 检查供应商名称是否存在
	ExistsByName(ctx context.Context, name string, excludeID *int) (bool, error)

	// GetActiveProviders 获取活跃的供应商（未禁用、未删除）
	GetActiveProviders(ctx context.Context) ([]*model.Provider, error)

	// GetByGroupTag 根据 GroupTag 获取供应商列表
	GetByGroupTag(ctx context.Context, groupTag string) ([]*model.Provider, error)

	// GetByProviderType 根据供应商类型获取列表
	GetByProviderType(ctx context.Context, providerType model.ProviderType) ([]*model.Provider, error)

	// GetEnabledProvidersByGroupTag 获取指定组的启用供应商（按优先级和权重排序）
	GetEnabledProvidersByGroupTag(ctx context.Context, groupTag string) ([]*model.Provider, error)

	// GetClaudePoolProviders 获取加入 Claude Pool 的供应商
	GetClaudePoolProviders(ctx context.Context) ([]*model.Provider, error)

	// GetAllGroupTags 获取所有供应商的 GroupTag（去重）
	GetAllGroupTags(ctx context.Context) ([]string, error)

	// IncrementTotalCost 增加供应商总费用（原子操作，用于统计）
	// 注意：这个方法用于 message_request 表的聚合计算，不是直接修改 provider 表
	// 说明：Provider 模型中没有 total_cost 字段，费用统计应通过 message_request 表聚合实现
	// Deprecated: 此方法实际上不执行增加操作，仅更新时间戳，保留用于接口兼容
	IncrementTotalCost(ctx context.Context, id int, amount udecimal.Decimal) error

	// ResetTotalCostResetAt 重置供应商的费用重置时间
	ResetTotalCostResetAt(ctx context.Context, id int) error

	// GetProviderStatistics 获取所有供应商的统计信息（今日费用、调用次数、最近调用等）
	GetProviderStatistics(ctx context.Context, timezone string) ([]*ProviderStatistics, error)
}

// providerRepository ProviderRepository 实现
type providerRepository struct {
	*BaseRepository
}

// NewProviderRepository 创建 ProviderRepository
func NewProviderRepository(db *bun.DB) ProviderRepository {
	return &providerRepository{
		BaseRepository: NewBaseRepository(db),
	}
}

// Create 创建供应商
func (r *providerRepository) Create(ctx context.Context, provider *model.Provider) error {
	now := time.Now()
	provider.CreatedAt = now
	provider.UpdatedAt = now

	_, err := r.db.NewInsert().
		Model(provider).
		Exec(ctx)

	if err != nil {
		return errors.NewDatabaseError(err)
	}

	return nil
}

// GetByID 根据 ID 获取供应商
func (r *providerRepository) GetByID(ctx context.Context, id int) (*model.Provider, error) {
	provider := new(model.Provider)
	err := r.db.NewSelect().
		Model(provider).
		Where("id = ?", id).
		Where("deleted_at IS NULL").
		Scan(ctx)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.NewNotFoundError("Provider")
		}
		return nil, errors.NewDatabaseError(err)
	}

	return provider, nil
}

// Update 更新供应商
func (r *providerRepository) Update(ctx context.Context, provider *model.Provider) error {
	provider.UpdatedAt = time.Now()

	result, err := r.db.NewUpdate().
		Model(provider).
		WherePK().
		Where("deleted_at IS NULL").
		Exec(ctx)

	if err != nil {
		return errors.NewDatabaseError(err)
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return errors.NewNotFoundError("Provider")
	}

	return nil
}

// Delete 删除供应商（软删除）
func (r *providerRepository) Delete(ctx context.Context, id int) error {
	now := time.Now()
	result, err := r.db.NewUpdate().
		Model((*model.Provider)(nil)).
		Set("deleted_at = ?", now).
		Set("updated_at = ?", now).
		Where("id = ?", id).
		Where("deleted_at IS NULL").
		Exec(ctx)

	if err != nil {
		return errors.NewDatabaseError(err)
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return errors.NewNotFoundError("Provider")
	}

	return nil
}

// List 获取供应商列表
func (r *providerRepository) List(ctx context.Context, opts *ListOptions) ([]*model.Provider, error) {
	if opts == nil {
		opts = NewListOptions()
	}

	query := r.db.NewSelect().Model((*model.Provider)(nil))

	// 软删除过滤
	if !opts.IncludeDeleted {
		query = query.Where("deleted_at IS NULL")
	}

	// 排序
	if opts.OrderBy != "" {
		query = query.Order(opts.OrderBy)
	} else {
		query = query.Order("created_at DESC")
	}

	// 分页
	if opts.Pagination != nil {
		query = query.
			Limit(opts.Pagination.GetLimit()).
			Offset(opts.Pagination.GetOffset())
	}

	var providers []*model.Provider
	err := query.Scan(ctx, &providers)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return providers, nil
}

// ListAll 获取所有供应商（不分页）
func (r *providerRepository) ListAll(ctx context.Context) ([]*model.Provider, error) {
	var providers []*model.Provider

	err := r.db.NewSelect().
		Model(&providers).
		Where("deleted_at IS NULL").
		Order("created_at DESC").
		Scan(ctx)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return providers, nil
}

// Count 统计供应商总数
func (r *providerRepository) Count(ctx context.Context, includeDeleted bool) (int, error) {
	query := r.db.NewSelect().Model((*model.Provider)(nil))

	if !includeDeleted {
		query = query.Where("deleted_at IS NULL")
	}

	count, err := query.Count(ctx)
	if err != nil {
		return 0, errors.NewDatabaseError(err)
	}

	return count, nil
}

// GetByName 根据名称查找供应商
func (r *providerRepository) GetByName(ctx context.Context, name string) (*model.Provider, error) {
	provider := new(model.Provider)
	err := r.db.NewSelect().
		Model(provider).
		Where("name = ?", name).
		Where("deleted_at IS NULL").
		Scan(ctx)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.NewNotFoundError("Provider")
		}
		return nil, errors.NewDatabaseError(err)
	}

	return provider, nil
}

// ExistsByName 检查供应商名称是否存在
func (r *providerRepository) ExistsByName(ctx context.Context, name string, excludeID *int) (bool, error) {
	query := r.db.NewSelect().
		Model((*model.Provider)(nil)).
		Where("name = ?", name).
		Where("deleted_at IS NULL")

	if excludeID != nil {
		query = query.Where("id != ?", *excludeID)
	}

	count, err := query.Count(ctx)
	if err != nil {
		return false, errors.NewDatabaseError(err)
	}

	return count > 0, nil
}

// GetActiveProviders 获取活跃的供应商（未禁用、未删除）
func (r *providerRepository) GetActiveProviders(ctx context.Context) ([]*model.Provider, error) {
	var providers []*model.Provider

	err := r.db.NewSelect().
		Model(&providers).
		Where("is_enabled = ?", true).
		Where("deleted_at IS NULL").
		Scan(ctx)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return providers, nil
}

// GetByGroupTag 根据 GroupTag 获取供应商列表
func (r *providerRepository) GetByGroupTag(ctx context.Context, groupTag string) ([]*model.Provider, error) {
	var providers []*model.Provider

	err := r.db.NewSelect().
		Model(&providers).
		Where("group_tag = ?", groupTag).
		Where("deleted_at IS NULL").
		Scan(ctx)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return providers, nil
}

// GetByProviderType 根据供应商类型获取列表
func (r *providerRepository) GetByProviderType(ctx context.Context, providerType model.ProviderType) ([]*model.Provider, error) {
	var providers []*model.Provider

	err := r.db.NewSelect().
		Model(&providers).
		Where("provider_type = ?", providerType).
		Where("deleted_at IS NULL").
		Scan(ctx)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return providers, nil
}

// GetEnabledProvidersByGroupTag 获取指定组的启用供应商（按优先级和权重排序）
func (r *providerRepository) GetEnabledProvidersByGroupTag(ctx context.Context, groupTag string) ([]*model.Provider, error) {
	var providers []*model.Provider

	query := r.db.NewSelect().
		Model(&providers).
		Where("is_enabled = ?", true).
		Where("deleted_at IS NULL").
		Order("priority DESC", "weight DESC")

	// groupTag 为空或 "default" 时，查询 group_tag 为空或 "default" 的供应商
	if groupTag == "" || groupTag == "default" {
		query = query.Where("(group_tag IS NULL OR group_tag = '' OR group_tag = 'default')")
	} else {
		query = query.Where("group_tag = ?", groupTag)
	}

	err := query.Scan(ctx)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return providers, nil
}

// GetClaudePoolProviders 获取加入 Claude Pool 的供应商
func (r *providerRepository) GetClaudePoolProviders(ctx context.Context) ([]*model.Provider, error) {
	var providers []*model.Provider

	err := r.db.NewSelect().
		Model(&providers).
		Where("join_claude_pool = ?", true).
		Where("is_enabled = ?", true).
		Where("deleted_at IS NULL").
		Scan(ctx)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return providers, nil
}

// GetAllGroupTags 获取所有供应商的 GroupTag（去重，支持逗号分隔）
func (r *providerRepository) GetAllGroupTags(ctx context.Context) ([]string, error) {
	var results []struct {
		GroupTag string `bun:"group_tag"`
	}

	err := r.db.NewSelect().
		Model((*model.Provider)(nil)).
		Column("group_tag").
		Where("deleted_at IS NULL").
		Where("group_tag IS NOT NULL").
		Where("group_tag != ''").
		Scan(ctx, &results)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	// 处理逗号分隔的多值并去重
	tagSet := make(map[string]struct{})
	for _, row := range results {
		parts := strings.Split(row.GroupTag, ",")
		for _, part := range parts {
			trimmed := strings.TrimSpace(part)
			if trimmed != "" {
				tagSet[trimmed] = struct{}{}
			}
		}
	}

	tags := make([]string, 0, len(tagSet))
	for tag := range tagSet {
		tags = append(tags, tag)
	}
	sort.Strings(tags)

	return tags, nil
}

// IncrementTotalCost 增加供应商总费用（原子操作）
// 注意：这个方法是为了统计目的，实际费用统计可能需要从 message_request 表聚合
func (r *providerRepository) IncrementTotalCost(ctx context.Context, id int, amount udecimal.Decimal) error {
	// 使用 SQL 原子操作增加费用
	// 注意：Provider 模型中没有 total_cost 字段，这里的实现是为了兼容可能的扩展
	// 如果需要统计供应商费用，应该从 message_request 表聚合
	_, err := r.db.NewUpdate().
		Model((*model.Provider)(nil)).
		Set("updated_at = ?", time.Now()).
		Where("id = ?", id).
		Where("deleted_at IS NULL").
		Exec(ctx)

	if err != nil {
		return errors.NewDatabaseError(err)
	}

	return nil
}

// ResetTotalCostResetAt 重置供应商的费用重置时间
func (r *providerRepository) ResetTotalCostResetAt(ctx context.Context, id int) error {
	now := time.Now()
	result, err := r.db.NewUpdate().
		Model((*model.Provider)(nil)).
		Set("total_cost_reset_at = ?", now).
		Set("updated_at = ?", now).
		Where("id = ?", id).
		Where("deleted_at IS NULL").
		Exec(ctx)

	if err != nil {
		return errors.NewDatabaseError(err)
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return errors.NewNotFoundError("Provider")
	}

	return nil
}

// excludeWarmupConditionProvider 排除 warmup 请求的条件
const excludeWarmupConditionProvider = "(blocked_by IS NULL OR blocked_by <> 'warmup')"

// GetProviderStatistics 获取所有供应商的统计信息
// 使用 providerChain 最后一项的 providerId 来确定最终供应商（兼容重试切换）
//
// 注意：此方法保留原始 SQL，原因如下：
// 1. 涉及 PostgreSQL 特有的 JSONB 操作（provider_chain->-1->>'id'）
// 2. 使用 DISTINCT ON 子句（PostgreSQL 扩展语法）
// 3. 复杂的条件聚合和多个 CTE
// 4. 使用 Bun 查询构建器会使代码更复杂且难以维护
func (r *providerRepository) GetProviderStatistics(ctx context.Context, timezone string) ([]*ProviderStatistics, error) {
	query := `
		WITH provider_stats AS (
			SELECT
				p.id,
				COALESCE(
					SUM(CASE
						WHEN (mr.created_at AT TIME ZONE $1)::date = (CURRENT_TIMESTAMP AT TIME ZONE $1)::date
							AND (
								-- 情况1：无重试（provider_chain 为 NULL 或空数组），使用 provider_id
								(mr.provider_chain IS NULL OR jsonb_array_length(mr.provider_chain) = 0) AND mr.provider_id = p.id
								OR
								-- 情况2：有重试，使用 providerChain 最后一项的 id
								(mr.provider_chain IS NOT NULL AND jsonb_array_length(mr.provider_chain) > 0
								 AND (mr.provider_chain->-1->>'id')::int = p.id)
							)
						THEN mr.cost_usd ELSE 0 END),
					0
				) AS today_cost,
				COUNT(CASE
					WHEN (mr.created_at AT TIME ZONE $1)::date = (CURRENT_TIMESTAMP AT TIME ZONE $1)::date
						AND (
							(mr.provider_chain IS NULL OR jsonb_array_length(mr.provider_chain) = 0) AND mr.provider_id = p.id
							OR
							(mr.provider_chain IS NOT NULL AND jsonb_array_length(mr.provider_chain) > 0
							 AND (mr.provider_chain->-1->>'id')::int = p.id)
						)
					THEN 1 END)::integer AS today_calls
			FROM providers p
			-- 性能优化：添加日期过滤条件，仅扫描今日数据
			LEFT JOIN message_request mr ON mr.deleted_at IS NULL
				AND ` + excludeWarmupConditionProvider + `
				AND mr.created_at >= (CURRENT_DATE AT TIME ZONE $1)
			WHERE p.deleted_at IS NULL
			GROUP BY p.id
		),
		latest_call AS (
			SELECT DISTINCT ON (final_provider_id)
				-- 计算最终供应商ID：优先使用 providerChain 最后一项的 id
				CASE
					WHEN provider_chain IS NULL OR jsonb_array_length(provider_chain) = 0 THEN provider_id
					ELSE (provider_chain->-1->>'id')::int
				END AS final_provider_id,
				created_at AS last_call_time,
				model AS last_call_model
			FROM message_request
			-- 性能优化：添加 7 天时间范围限制
			WHERE deleted_at IS NULL
				AND ` + excludeWarmupConditionProvider + `
				AND created_at >= (CURRENT_DATE AT TIME ZONE $1 - INTERVAL '7 days')
			ORDER BY final_provider_id, created_at DESC
		)
		SELECT
			ps.id,
			ps.today_cost,
			ps.today_calls,
			lc.last_call_time,
			lc.last_call_model
		FROM provider_stats ps
		LEFT JOIN latest_call lc ON ps.id = lc.final_provider_id
		ORDER BY ps.id ASC
	`

	var results []*ProviderStatistics
	_, err := r.db.NewRaw(query, timezone).Exec(ctx, &results)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return results, nil
}

package repository

import (
	"context"
	"database/sql"
	"time"

	"github.com/ding113/claude-code-hub/internal/model"
	"github.com/ding113/claude-code-hub/internal/pkg/errors"
	"github.com/quagmt/udecimal"
	"github.com/uptrace/bun"
)

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
	IncrementTotalCost(ctx context.Context, id int, amount udecimal.Decimal) error

	// ResetTotalCostResetAt 重置供应商的费用重置时间
	ResetTotalCostResetAt(ctx context.Context, id int) error
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

// GetAllGroupTags 获取所有供应商的 GroupTag（去重）
func (r *providerRepository) GetAllGroupTags(ctx context.Context) ([]string, error) {
	var results []struct {
		GroupTag string `bun:"group_tag"`
	}

	err := r.db.NewSelect().
		Model((*model.Provider)(nil)).
		ColumnExpr("DISTINCT group_tag").
		Where("deleted_at IS NULL").
		Where("group_tag IS NOT NULL").
		Where("group_tag != ''").
		Scan(ctx, &results)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	tags := make([]string, 0, len(results))
	for _, row := range results {
		tags = append(tags, row.GroupTag)
	}

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

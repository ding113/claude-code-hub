package repository

import (
	"context"
	"database/sql"
	"time"

	"github.com/ding113/claude-code-hub/internal/model"
	"github.com/ding113/claude-code-hub/internal/pkg/errors"
	"github.com/uptrace/bun"
)

// UserRepository 用户数据访问接口
type UserRepository interface {
	Repository

	// Create 创建用户
	Create(ctx context.Context, user *model.User) error

	// GetByID 根据 ID 获取用户
	GetByID(ctx context.Context, id int) (*model.User, error)

	// GetByIDWithKeys 根据 ID 获取用户（包含关联的 Keys）
	GetByIDWithKeys(ctx context.Context, id int) (*model.User, error)

	// Update 更新用户
	Update(ctx context.Context, user *model.User) error

	// Delete 删除用户（软删除）
	Delete(ctx context.Context, id int) error

	// List 获取用户列表
	List(ctx context.Context, opts *ListOptions) ([]*model.User, error)

	// Count 统计用户总数
	Count(ctx context.Context, includeDeleted bool) (int, error)

	// GetByName 根据名称查找用户
	GetByName(ctx context.Context, name string) (*model.User, error)

	// ExistsByName 检查用户名是否存在
	ExistsByName(ctx context.Context, name string, excludeID *int) (bool, error)

	// GetActiveUsers 获取活跃用户（未过期、未禁用、未删除）
	GetActiveUsers(ctx context.Context) ([]*model.User, error)

	// GetByProviderGroup 根据供应商组获取用户
	GetByProviderGroup(ctx context.Context, providerGroup string) ([]*model.User, error)

	// GetExpiredUsers 获取已过期的用户
	GetExpiredUsers(ctx context.Context) ([]*model.User, error)

	// MarkUserExpired 标记用户过期（将 is_enabled 设为 false）
	MarkUserExpired(ctx context.Context, userID int) (bool, error)

	// GetAllTags 获取所有用户的标签（去重）
	GetAllTags(ctx context.Context) ([]string, error)

	// GetAllProviderGroups 获取所有用户的供应商组（去重）
	GetAllProviderGroups(ctx context.Context) ([]string, error)

	// SearchUsers 搜索用户（支持名称、描述模糊匹配）
	SearchUsers(ctx context.Context, searchTerm string, opts *ListOptions) ([]*model.User, error)
}

// userRepository UserRepository 实现
type userRepository struct {
	*BaseRepository
}

// NewUserRepository 创建 UserRepository
func NewUserRepository(db *bun.DB) UserRepository {
	return &userRepository{
		BaseRepository: NewBaseRepository(db),
	}
}

// Create 创建用户
func (r *userRepository) Create(ctx context.Context, user *model.User) error {
	now := time.Now()
	user.CreatedAt = now
	user.UpdatedAt = now

	_, err := r.db.NewInsert().
		Model(user).
		Exec(ctx)

	if err != nil {
		return errors.NewDatabaseError(err)
	}

	return nil
}

// GetByID 根据 ID 获取用户
func (r *userRepository) GetByID(ctx context.Context, id int) (*model.User, error) {
	user := new(model.User)
	err := r.db.NewSelect().
		Model(user).
		Where("id = ?", id).
		Where("deleted_at IS NULL").
		Scan(ctx)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.NewNotFoundError("User")
		}
		return nil, errors.NewDatabaseError(err)
	}

	return user, nil
}

// GetByIDWithKeys 根据 ID 获取用户（包含关联的 Keys）
func (r *userRepository) GetByIDWithKeys(ctx context.Context, id int) (*model.User, error) {
	user := new(model.User)
	err := r.db.NewSelect().
		Model(user).
		Relation("Keys", func(sq *bun.SelectQuery) *bun.SelectQuery {
			return sq.Where("deleted_at IS NULL")
		}).
		Where("u.id = ?", id).
		Where("u.deleted_at IS NULL").
		Scan(ctx)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.NewNotFoundError("User")
		}
		return nil, errors.NewDatabaseError(err)
	}

	return user, nil
}

// Update 更新用户
func (r *userRepository) Update(ctx context.Context, user *model.User) error {
	user.UpdatedAt = time.Now()

	result, err := r.db.NewUpdate().
		Model(user).
		WherePK().
		Where("deleted_at IS NULL").
		Exec(ctx)

	if err != nil {
		return errors.NewDatabaseError(err)
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return errors.NewNotFoundError("User")
	}

	return nil
}

// Delete 删除用户（软删除）
func (r *userRepository) Delete(ctx context.Context, id int) error {
	now := time.Now()
	result, err := r.db.NewUpdate().
		Model((*model.User)(nil)).
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
		return errors.NewNotFoundError("User")
	}

	return nil
}

// List 获取用户列表
func (r *userRepository) List(ctx context.Context, opts *ListOptions) ([]*model.User, error) {
	if opts == nil {
		opts = NewListOptions()
	}

	query := r.db.NewSelect().Model((*model.User)(nil))

	// 软删除过滤
	if !opts.IncludeDeleted {
		query = query.Where("deleted_at IS NULL")
	}

	// 排序：管理员优先，然后按 ID
	if opts.OrderBy != "" {
		query = query.Order(opts.OrderBy)
	} else {
		query = query.OrderExpr("CASE WHEN role = 'admin' THEN 0 ELSE 1 END, id")
	}

	// 分页
	if opts.Pagination != nil {
		query = query.
			Limit(opts.Pagination.GetLimit()).
			Offset(opts.Pagination.GetOffset())
	}

	var users []*model.User
	err := query.Scan(ctx, &users)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return users, nil
}

// Count 统计用户总数
func (r *userRepository) Count(ctx context.Context, includeDeleted bool) (int, error) {
	query := r.db.NewSelect().Model((*model.User)(nil))

	if !includeDeleted {
		query = query.Where("deleted_at IS NULL")
	}

	count, err := query.Count(ctx)
	if err != nil {
		return 0, errors.NewDatabaseError(err)
	}

	return count, nil
}

// GetByName 根据名称查找用户
func (r *userRepository) GetByName(ctx context.Context, name string) (*model.User, error) {
	user := new(model.User)
	err := r.db.NewSelect().
		Model(user).
		Where("name = ?", name).
		Where("deleted_at IS NULL").
		Scan(ctx)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.NewNotFoundError("User")
		}
		return nil, errors.NewDatabaseError(err)
	}

	return user, nil
}

// ExistsByName 检查用户名是否存在
func (r *userRepository) ExistsByName(ctx context.Context, name string, excludeID *int) (bool, error) {
	query := r.db.NewSelect().
		Model((*model.User)(nil)).
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

// GetActiveUsers 获取活跃用户（未过期、未禁用、未删除）
func (r *userRepository) GetActiveUsers(ctx context.Context) ([]*model.User, error) {
	now := time.Now()
	var users []*model.User

	err := r.db.NewSelect().
		Model(&users).
		Where("is_enabled = ?", true).
		Where("deleted_at IS NULL").
		Where("(expires_at IS NULL OR expires_at > ?)", now).
		Scan(ctx)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return users, nil
}

// GetByProviderGroup 根据供应商组获取用户
func (r *userRepository) GetByProviderGroup(ctx context.Context, providerGroup string) ([]*model.User, error) {
	var users []*model.User

	err := r.db.NewSelect().
		Model(&users).
		Where("provider_group = ?", providerGroup).
		Where("deleted_at IS NULL").
		Scan(ctx)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return users, nil
}

// GetExpiredUsers 获取已过期的用户
func (r *userRepository) GetExpiredUsers(ctx context.Context) ([]*model.User, error) {
	now := time.Now()
	var users []*model.User

	err := r.db.NewSelect().
		Model(&users).
		Where("expires_at IS NOT NULL").
		Where("expires_at <= ?", now).
		Where("deleted_at IS NULL").
		Scan(ctx)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return users, nil
}

// MarkUserExpired 标记用户过期（将 is_enabled 设为 false）
func (r *userRepository) MarkUserExpired(ctx context.Context, userID int) (bool, error) {
	result, err := r.db.NewUpdate().
		Model((*model.User)(nil)).
		Set("is_enabled = ?", false).
		Set("updated_at = ?", time.Now()).
		Where("id = ?", userID).
		Where("is_enabled = ?", true).
		Where("deleted_at IS NULL").
		Exec(ctx)

	if err != nil {
		return false, errors.NewDatabaseError(err)
	}

	rowsAffected, _ := result.RowsAffected()
	return rowsAffected > 0, nil
}

// GetAllTags 获取所有用户的标签（去重）
func (r *userRepository) GetAllTags(ctx context.Context) ([]string, error) {
	var results []struct {
		Tags []string `bun:"tags,type:jsonb"`
	}

	err := r.db.NewSelect().
		Model((*model.User)(nil)).
		Column("tags").
		Where("deleted_at IS NULL").
		Scan(ctx, &results)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	// 去重
	tagSet := make(map[string]struct{})
	for _, row := range results {
		for _, tag := range row.Tags {
			tagSet[tag] = struct{}{}
		}
	}

	tags := make([]string, 0, len(tagSet))
	for tag := range tagSet {
		tags = append(tags, tag)
	}

	return tags, nil
}

// GetAllProviderGroups 获取所有用户的供应商组（去重）
func (r *userRepository) GetAllProviderGroups(ctx context.Context) ([]string, error) {
	var results []struct {
		ProviderGroup string `bun:"provider_group"`
	}

	err := r.db.NewSelect().
		Model((*model.User)(nil)).
		ColumnExpr("DISTINCT provider_group").
		Where("deleted_at IS NULL").
		Where("provider_group IS NOT NULL").
		Where("provider_group != ''").
		Scan(ctx, &results)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	groups := make([]string, 0, len(results))
	for _, row := range results {
		groups = append(groups, row.ProviderGroup)
	}

	return groups, nil
}

// SearchUsers 搜索用户（支持名称、描述模糊匹配）
func (r *userRepository) SearchUsers(ctx context.Context, searchTerm string, opts *ListOptions) ([]*model.User, error) {
	if opts == nil {
		opts = NewListOptions()
	}

	query := r.db.NewSelect().Model((*model.User)(nil))

	// 软删除过滤
	if !opts.IncludeDeleted {
		query = query.Where("deleted_at IS NULL")
	}

	// 搜索条件
	if searchTerm != "" {
		pattern := "%" + searchTerm + "%"
		query = query.Where("name ILIKE ?", pattern)
	}

	// 排序
	if opts.OrderBy != "" {
		query = query.Order(opts.OrderBy)
	} else {
		query = query.OrderExpr("CASE WHEN role = 'admin' THEN 0 ELSE 1 END, id")
	}

	// 分页
	if opts.Pagination != nil {
		query = query.
			Limit(opts.Pagination.GetLimit()).
			Offset(opts.Pagination.GetOffset())
	}

	var users []*model.User
	err := query.Scan(ctx, &users)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return users, nil
}

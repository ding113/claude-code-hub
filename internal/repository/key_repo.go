package repository

import (
	"context"
	"database/sql"
	"time"

	"github.com/ding113/claude-code-hub/internal/model"
	"github.com/ding113/claude-code-hub/internal/pkg/errors"
	"github.com/uptrace/bun"
)

// KeyRepository Key 数据访问接口
type KeyRepository interface {
	Repository

	// Create 创建 API Key
	Create(ctx context.Context, key *model.Key) error

	// GetByID 根据 ID 获取 Key
	GetByID(ctx context.Context, id int) (*model.Key, error)

	// GetByKey 根据 Key 字符串获取（用于认证）
	GetByKey(ctx context.Context, key string) (*model.Key, error)

	// GetByKeyWithUser 根据 Key 字符串获取（包含关联的 User）
	GetByKeyWithUser(ctx context.Context, key string) (*model.Key, error)

	// Update 更新 Key
	Update(ctx context.Context, key *model.Key) error

	// Delete 删除 Key（软删除）
	Delete(ctx context.Context, id int) error

	// List 获取 Key 列表
	List(ctx context.Context, opts *ListOptions) ([]*model.Key, error)

	// ListByUserID 根据用户 ID 获取 Key 列表
	ListByUserID(ctx context.Context, userID int) ([]*model.Key, error)

	// ListByUserIDs 批量根据用户 ID 获取 Key 列表（返回 map[userID][]Key）
	ListByUserIDs(ctx context.Context, userIDs []int) (map[int][]*model.Key, error)

	// Count 统计 Key 总数
	Count(ctx context.Context, includeDeleted bool) (int, error)

	// CountByUserID 统计用户的 Key 数量
	CountByUserID(ctx context.Context, userID int) (int, error)

	// ExistsByName 检查 Key 名称是否存在（同一用户下）
	ExistsByName(ctx context.Context, userID int, name string, excludeID *int) (bool, error)

	// ExistsByKey 检查 Key 字符串是否存在
	ExistsByKey(ctx context.Context, keyStr string, excludeID *int) (bool, error)

	// GetActiveKeys 获取活跃的 Key（未过期、未禁用、未删除）
	GetActiveKeys(ctx context.Context) ([]*model.Key, error)

	// GetExpiredKeys 获取已过期的 Key
	GetExpiredKeys(ctx context.Context) ([]*model.Key, error)

	// GetByProviderGroup 根据供应商组获取 Key
	GetByProviderGroup(ctx context.Context, providerGroup string) ([]*model.Key, error)

	// GetWebUILoginKeys 获取可登录 Web UI 的 Key
	GetWebUILoginKeys(ctx context.Context) ([]*model.Key, error)

	// MarkKeyExpired 标记 Key 过期（将 is_enabled 设为 false）
	MarkKeyExpired(ctx context.Context, keyID int) (bool, error)
}

// keyRepository KeyRepository 实现
type keyRepository struct {
	*BaseRepository
}

// NewKeyRepository 创建 KeyRepository
func NewKeyRepository(db *bun.DB) KeyRepository {
	return &keyRepository{
		BaseRepository: NewBaseRepository(db),
	}
}

// Create 创建 API Key
func (r *keyRepository) Create(ctx context.Context, key *model.Key) error {
	now := time.Now()
	key.CreatedAt = now
	key.UpdatedAt = now

	_, err := r.db.NewInsert().
		Model(key).
		Exec(ctx)

	if err != nil {
		return errors.NewDatabaseError(err)
	}

	return nil
}

// GetByID 根据 ID 获取 Key
func (r *keyRepository) GetByID(ctx context.Context, id int) (*model.Key, error) {
	key := new(model.Key)
	err := r.db.NewSelect().
		Model(key).
		Where("id = ?", id).
		Where("deleted_at IS NULL").
		Scan(ctx)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.NewNotFoundError("Key")
		}
		return nil, errors.NewDatabaseError(err)
	}

	return key, nil
}

// GetByKey 根据 Key 字符串获取（用于认证）
func (r *keyRepository) GetByKey(ctx context.Context, keyStr string) (*model.Key, error) {
	key := new(model.Key)
	err := r.db.NewSelect().
		Model(key).
		Where("key = ?", keyStr).
		Where("deleted_at IS NULL").
		Scan(ctx)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.NewNotFoundError("Key")
		}
		return nil, errors.NewDatabaseError(err)
	}

	return key, nil
}

// GetByKeyWithUser 根据 Key 字符串获取（包含关联的 User）
func (r *keyRepository) GetByKeyWithUser(ctx context.Context, keyStr string) (*model.Key, error) {
	key := new(model.Key)
	err := r.db.NewSelect().
		Model(key).
		Relation("User").
		Where("k.key = ?", keyStr).
		Where("k.deleted_at IS NULL").
		Scan(ctx)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.NewNotFoundError("Key")
		}
		return nil, errors.NewDatabaseError(err)
	}

	return key, nil
}

// Update 更新 Key
func (r *keyRepository) Update(ctx context.Context, key *model.Key) error {
	key.UpdatedAt = time.Now()

	result, err := r.db.NewUpdate().
		Model(key).
		WherePK().
		Where("deleted_at IS NULL").
		Exec(ctx)

	if err != nil {
		return errors.NewDatabaseError(err)
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return errors.NewNotFoundError("Key")
	}

	return nil
}

// Delete 删除 Key（软删除）
func (r *keyRepository) Delete(ctx context.Context, id int) error {
	now := time.Now()
	result, err := r.db.NewUpdate().
		Model((*model.Key)(nil)).
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
		return errors.NewNotFoundError("Key")
	}

	return nil
}

// List 获取 Key 列表
func (r *keyRepository) List(ctx context.Context, opts *ListOptions) ([]*model.Key, error) {
	if opts == nil {
		opts = NewListOptions()
	}

	query := r.db.NewSelect().Model((*model.Key)(nil))

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

	var keys []*model.Key
	err := query.Scan(ctx, &keys)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return keys, nil
}

// ListByUserID 根据用户 ID 获取 Key 列表
func (r *keyRepository) ListByUserID(ctx context.Context, userID int) ([]*model.Key, error) {
	var keys []*model.Key

	err := r.db.NewSelect().
		Model(&keys).
		Where("user_id = ?", userID).
		Where("deleted_at IS NULL").
		Order("created_at ASC").
		Scan(ctx)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return keys, nil
}

// ListByUserIDs 批量根据用户 ID 获取 Key 列表
func (r *keyRepository) ListByUserIDs(ctx context.Context, userIDs []int) (map[int][]*model.Key, error) {
	if len(userIDs) == 0 {
		return make(map[int][]*model.Key), nil
	}

	var keys []*model.Key
	err := r.db.NewSelect().
		Model(&keys).
		Where("user_id IN (?)", bun.In(userIDs)).
		Where("deleted_at IS NULL").
		Order("user_id ASC", "created_at ASC").
		Scan(ctx)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	// 按 userID 分组
	result := make(map[int][]*model.Key)
	for _, userID := range userIDs {
		result[userID] = []*model.Key{}
	}
	for _, key := range keys {
		result[key.UserID] = append(result[key.UserID], key)
	}

	return result, nil
}

// Count 统计 Key 总数
func (r *keyRepository) Count(ctx context.Context, includeDeleted bool) (int, error) {
	query := r.db.NewSelect().Model((*model.Key)(nil))

	if !includeDeleted {
		query = query.Where("deleted_at IS NULL")
	}

	count, err := query.Count(ctx)
	if err != nil {
		return 0, errors.NewDatabaseError(err)
	}

	return count, nil
}

// CountByUserID 统计用户的 Key 数量
func (r *keyRepository) CountByUserID(ctx context.Context, userID int) (int, error) {
	count, err := r.db.NewSelect().
		Model((*model.Key)(nil)).
		Where("user_id = ?", userID).
		Where("deleted_at IS NULL").
		Count(ctx)

	if err != nil {
		return 0, errors.NewDatabaseError(err)
	}

	return count, nil
}

// ExistsByName 检查 Key 名称是否存在（同一用户下）
func (r *keyRepository) ExistsByName(ctx context.Context, userID int, name string, excludeID *int) (bool, error) {
	query := r.db.NewSelect().
		Model((*model.Key)(nil)).
		Where("user_id = ?", userID).
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

// ExistsByKey 检查 Key 字符串是否存在
func (r *keyRepository) ExistsByKey(ctx context.Context, keyStr string, excludeID *int) (bool, error) {
	query := r.db.NewSelect().
		Model((*model.Key)(nil)).
		Where("key = ?", keyStr).
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

// GetActiveKeys 获取活跃的 Key（未过期、未禁用、未删除）
func (r *keyRepository) GetActiveKeys(ctx context.Context) ([]*model.Key, error) {
	now := time.Now()
	var keys []*model.Key

	err := r.db.NewSelect().
		Model(&keys).
		Where("is_enabled = ?", true).
		Where("deleted_at IS NULL").
		Where("(expires_at IS NULL OR expires_at > ?)", now).
		Scan(ctx)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return keys, nil
}

// GetExpiredKeys 获取已过期的 Key
func (r *keyRepository) GetExpiredKeys(ctx context.Context) ([]*model.Key, error) {
	now := time.Now()
	var keys []*model.Key

	err := r.db.NewSelect().
		Model(&keys).
		Where("expires_at IS NOT NULL").
		Where("expires_at <= ?", now).
		Where("deleted_at IS NULL").
		Scan(ctx)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return keys, nil
}

// GetByProviderGroup 根据供应商组获取 Key
func (r *keyRepository) GetByProviderGroup(ctx context.Context, providerGroup string) ([]*model.Key, error) {
	var keys []*model.Key

	err := r.db.NewSelect().
		Model(&keys).
		Where("provider_group = ?", providerGroup).
		Where("deleted_at IS NULL").
		Scan(ctx)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return keys, nil
}

// GetWebUILoginKeys 获取可登录 Web UI 的 Key
func (r *keyRepository) GetWebUILoginKeys(ctx context.Context) ([]*model.Key, error) {
	var keys []*model.Key

	err := r.db.NewSelect().
		Model(&keys).
		Where("can_login_web_ui = ?", true).
		Where("is_enabled = ?", true).
		Where("deleted_at IS NULL").
		Scan(ctx)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return keys, nil
}

// MarkKeyExpired 标记 Key 过期（将 is_enabled 设为 false）
func (r *keyRepository) MarkKeyExpired(ctx context.Context, keyID int) (bool, error) {
	result, err := r.db.NewUpdate().
		Model((*model.Key)(nil)).
		Set("is_enabled = ?", false).
		Set("updated_at = ?", time.Now()).
		Where("id = ?", keyID).
		Where("is_enabled = ?", true).
		Where("deleted_at IS NULL").
		Exec(ctx)

	if err != nil {
		return false, errors.NewDatabaseError(err)
	}

	rowsAffected, _ := result.RowsAffected()
	return rowsAffected > 0, nil
}

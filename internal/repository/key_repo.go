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

// KeyUsageToday Key 今日用量统计
type KeyUsageToday struct {
	KeyID     int              `bun:"key_id"`
	TotalCost udecimal.Decimal `bun:"total_cost"`
}

// KeyModelStat Key 模型统计
type KeyModelStat struct {
	Model     string           `bun:"model"`
	CallCount int              `bun:"call_count"`
	TotalCost udecimal.Decimal `bun:"total_cost"`
}

// KeyStatistics Key 统计信息
type KeyStatistics struct {
	KeyID            int             `bun:"key_id"`
	TodayCallCount   int             `bun:"today_call_count"`
	LastUsedAt       *time.Time      `bun:"last_used_at"`
	LastProviderName *string         `bun:"last_provider_name"`
	ModelStats       []*KeyModelStat // 模型统计（需要单独查询）
}

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

	// FindActiveKeyByUserIDAndName 根据用户ID和名称查找活跃Key（防止重复）
	FindActiveKeyByUserIDAndName(ctx context.Context, userID int, name string) (*model.Key, error)

	// FindKeyUsageToday 获取用户下所有Key的今日费用统计（用于限流检查）
	FindKeyUsageToday(ctx context.Context, userID int, timezone string) ([]*KeyUsageToday, error)

	// FindKeyUsageTodayBatch 批量获取多个用户的Key今日用量（性能优化）
	FindKeyUsageTodayBatch(ctx context.Context, userIDs []int, timezone string) (map[int][]*KeyUsageToday, error)

	// FindKeysWithStatistics 获取Key的详细统计信息（管理后台展示）
	FindKeysWithStatistics(ctx context.Context, userID int, timezone string) ([]*KeyStatistics, error)

	// FindKeysWithStatisticsBatch 批量获取多个用户的Key统计（性能优化）
	FindKeysWithStatisticsBatch(ctx context.Context, userIDs []int, timezone string) (map[int][]*KeyStatistics, error)
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

// GetByKey 根据 Key 字符串获取活跃的 Key（用于认证）
// 只返回启用且未过期的 Key
func (r *keyRepository) GetByKey(ctx context.Context, keyStr string) (*model.Key, error) {
	now := time.Now()
	key := new(model.Key)
	err := r.db.NewSelect().
		Model(key).
		Where("key = ?", keyStr).
		Where("deleted_at IS NULL").
		Where("is_enabled = ?", true).
		Where("(expires_at IS NULL OR expires_at > ?)", now).
		Scan(ctx)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.NewNotFoundError("Key")
		}
		return nil, errors.NewDatabaseError(err)
	}

	return key, nil
}

// GetByKeyWithUser 根据 Key 字符串获取活跃的 Key（包含关联的 User）
// 只返回启用且未过期的 Key，且关联的 User 未删除
func (r *keyRepository) GetByKeyWithUser(ctx context.Context, keyStr string) (*model.Key, error) {
	now := time.Now()
	key := new(model.Key)
	err := r.db.NewSelect().
		Model(key).
		Relation("User", func(q *bun.SelectQuery) *bun.SelectQuery {
			return q.Where("deleted_at IS NULL")
		}).
		Where("k.key = ?", keyStr).
		Where("k.deleted_at IS NULL").
		Where("k.is_enabled = ?", true).
		Where("(k.expires_at IS NULL OR k.expires_at > ?)", now).
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

// CountByUserID 统计用户的活跃 Key 数量（仅统计启用的 Key）
func (r *keyRepository) CountByUserID(ctx context.Context, userID int) (int, error) {
	count, err := r.db.NewSelect().
		Model((*model.Key)(nil)).
		Where("user_id = ?", userID).
		Where("is_enabled = ?", true).
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

// FindActiveKeyByUserIDAndName 根据用户ID和名称查找活跃Key（防止重复）
func (r *keyRepository) FindActiveKeyByUserIDAndName(ctx context.Context, userID int, name string) (*model.Key, error) {
	now := time.Now()
	key := new(model.Key)
	err := r.db.NewSelect().
		Model(key).
		Where("user_id = ?", userID).
		Where("name = ?", name).
		Where("deleted_at IS NULL").
		Where("is_enabled = ?", true).
		Where("(expires_at IS NULL OR expires_at > ?)", now).
		Scan(ctx)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil // 未找到返回 nil，不是错误
		}
		return nil, errors.NewDatabaseError(err)
	}

	return key, nil
}

// excludeWarmupConditionKey 排除 warmup 请求的条件（与 statistics_repo 保持一致）
const excludeWarmupConditionKey = "(blocked_by IS NULL OR blocked_by <> 'warmup')"

// FindKeyUsageToday 获取用户下所有Key的今日费用统计（用于限流检查）
func (r *keyRepository) FindKeyUsageToday(ctx context.Context, userID int, timezone string) ([]*KeyUsageToday, error) {
	query := `
		SELECT
			k.id AS key_id,
			COALESCE(SUM(mr.cost_usd), 0) AS total_cost
		FROM keys k
		LEFT JOIN message_request mr ON mr.key = k.key
			AND mr.deleted_at IS NULL
			AND ` + excludeWarmupConditionKey + `
			AND (mr.created_at AT TIME ZONE $1)::date = (CURRENT_TIMESTAMP AT TIME ZONE $1)::date
		WHERE k.user_id = $2
			AND k.deleted_at IS NULL
		GROUP BY k.id
	`

	var results []*KeyUsageToday
	_, err := r.db.NewRaw(query, timezone, userID).Exec(ctx, &results)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return results, nil
}

// FindKeyUsageTodayBatch 批量获取多个用户的Key今日用量（性能优化）
func (r *keyRepository) FindKeyUsageTodayBatch(ctx context.Context, userIDs []int, timezone string) (map[int][]*KeyUsageToday, error) {
	if len(userIDs) == 0 {
		return make(map[int][]*KeyUsageToday), nil
	}

	query := `
		SELECT
			k.user_id,
			k.id AS key_id,
			COALESCE(SUM(mr.cost_usd), 0) AS total_cost
		FROM keys k
		LEFT JOIN message_request mr ON mr.key = k.key
			AND mr.deleted_at IS NULL
			AND ` + excludeWarmupConditionKey + `
			AND (mr.created_at AT TIME ZONE $1)::date = (CURRENT_TIMESTAMP AT TIME ZONE $1)::date
		WHERE k.user_id = ANY($2)
			AND k.deleted_at IS NULL
		GROUP BY k.user_id, k.id
		ORDER BY k.user_id, k.id
	`

	var rows []struct {
		UserID    int              `bun:"user_id"`
		KeyID     int              `bun:"key_id"`
		TotalCost udecimal.Decimal `bun:"total_cost"`
	}
	_, err := r.db.NewRaw(query, timezone, bun.In(userIDs)).Exec(ctx, &rows)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	// 按 userID 分组
	result := make(map[int][]*KeyUsageToday)
	for _, userID := range userIDs {
		result[userID] = []*KeyUsageToday{}
	}
	for _, row := range rows {
		result[row.UserID] = append(result[row.UserID], &KeyUsageToday{
			KeyID:     row.KeyID,
			TotalCost: row.TotalCost,
		})
	}

	return result, nil
}

// FindKeysWithStatistics 获取Key的详细统计信息（管理后台展示）
func (r *keyRepository) FindKeysWithStatistics(ctx context.Context, userID int, timezone string) ([]*KeyStatistics, error) {
	// 1. 获取用户的所有 keys
	keys, err := r.ListByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}

	if len(keys) == 0 {
		return []*KeyStatistics{}, nil
	}

	// 收集所有 key 字符串
	keyStrings := make([]string, len(keys))
	keyIDMap := make(map[string]int)
	for i, k := range keys {
		keyStrings[i] = k.Key
		keyIDMap[k.Key] = k.ID
	}

	// 2. 查询今日调用次数
	todayCountQuery := `
		SELECT
			mr.key,
			COUNT(*) AS count
		FROM message_request mr
		WHERE mr.key = ANY($1)
			AND mr.deleted_at IS NULL
			AND ` + excludeWarmupConditionKey + `
			AND (mr.created_at AT TIME ZONE $2)::date = (CURRENT_TIMESTAMP AT TIME ZONE $2)::date
		GROUP BY mr.key
	`
	var todayCountRows []struct {
		Key   string `bun:"key"`
		Count int    `bun:"count"`
	}
	_, err = r.db.NewRaw(todayCountQuery, bun.In(keyStrings), timezone).Exec(ctx, &todayCountRows)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}
	todayCountMap := make(map[string]int)
	for _, row := range todayCountRows {
		todayCountMap[row.Key] = row.Count
	}

	// 3. 查询最后使用时间和供应商（使用 DISTINCT ON）
	lastUsageQuery := `
		SELECT DISTINCT ON (mr.key)
			mr.key,
			mr.created_at AS last_used_at,
			p.name AS last_provider_name
		FROM message_request mr
		INNER JOIN providers p ON mr.provider_id = p.id
		WHERE mr.key = ANY($1)
			AND mr.deleted_at IS NULL
			AND ` + excludeWarmupConditionKey + `
		ORDER BY mr.key, mr.created_at DESC
	`
	var lastUsageRows []struct {
		Key              string     `bun:"key"`
		LastUsedAt       *time.Time `bun:"last_used_at"`
		LastProviderName *string    `bun:"last_provider_name"`
	}
	_, err = r.db.NewRaw(lastUsageQuery, bun.In(keyStrings)).Exec(ctx, &lastUsageRows)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}
	lastUsageMap := make(map[string]struct {
		LastUsedAt       *time.Time
		LastProviderName *string
	})
	for _, row := range lastUsageRows {
		lastUsageMap[row.Key] = struct {
			LastUsedAt       *time.Time
			LastProviderName *string
		}{
			LastUsedAt:       row.LastUsedAt,
			LastProviderName: row.LastProviderName,
		}
	}

	// 4. 查询模型统计（今日）
	modelStatsQuery := `
		SELECT
			mr.key,
			mr.model,
			COUNT(*) AS call_count,
			COALESCE(SUM(mr.cost_usd), 0) AS total_cost
		FROM message_request mr
		WHERE mr.key = ANY($1)
			AND mr.deleted_at IS NULL
			AND ` + excludeWarmupConditionKey + `
			AND (mr.created_at AT TIME ZONE $2)::date = (CURRENT_TIMESTAMP AT TIME ZONE $2)::date
			AND mr.model IS NOT NULL
		GROUP BY mr.key, mr.model
		ORDER BY mr.key, COUNT(*) DESC
	`
	var modelStatsRows []struct {
		Key       string           `bun:"key"`
		Model     string           `bun:"model"`
		CallCount int              `bun:"call_count"`
		TotalCost udecimal.Decimal `bun:"total_cost"`
	}
	_, err = r.db.NewRaw(modelStatsQuery, bun.In(keyStrings), timezone).Exec(ctx, &modelStatsRows)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}
	modelStatsMap := make(map[string][]*KeyModelStat)
	for _, row := range modelStatsRows {
		modelStatsMap[row.Key] = append(modelStatsMap[row.Key], &KeyModelStat{
			Model:     row.Model,
			CallCount: row.CallCount,
			TotalCost: row.TotalCost,
		})
	}

	// 5. 组装结果
	results := make([]*KeyStatistics, len(keys))
	for i, k := range keys {
		lastUsage := lastUsageMap[k.Key]
		results[i] = &KeyStatistics{
			KeyID:            k.ID,
			TodayCallCount:   todayCountMap[k.Key],
			LastUsedAt:       lastUsage.LastUsedAt,
			LastProviderName: lastUsage.LastProviderName,
			ModelStats:       modelStatsMap[k.Key],
		}
		if results[i].ModelStats == nil {
			results[i].ModelStats = []*KeyModelStat{}
		}
	}

	return results, nil
}

// FindKeysWithStatisticsBatch 批量获取多个用户的Key统计（性能优化）
func (r *keyRepository) FindKeysWithStatisticsBatch(ctx context.Context, userIDs []int, timezone string) (map[int][]*KeyStatistics, error) {
	if len(userIDs) == 0 {
		return make(map[int][]*KeyStatistics), nil
	}

	// 1. 批量获取所有用户的 keys
	keysMap, err := r.ListByUserIDs(ctx, userIDs)
	if err != nil {
		return nil, err
	}

	// 收集所有 key 字符串
	var allKeyStrings []string
	keyStringToUserID := make(map[string]int)
	keyStringToKeyID := make(map[string]int)
	for userID, userKeys := range keysMap {
		for _, k := range userKeys {
			allKeyStrings = append(allKeyStrings, k.Key)
			keyStringToUserID[k.Key] = userID
			keyStringToKeyID[k.Key] = k.ID
		}
	}

	if len(allKeyStrings) == 0 {
		result := make(map[int][]*KeyStatistics)
		for _, userID := range userIDs {
			result[userID] = []*KeyStatistics{}
		}
		return result, nil
	}

	// 2. 查询今日调用次数
	todayCountQuery := `
		SELECT
			mr.key,
			COUNT(*) AS count
		FROM message_request mr
		WHERE mr.key = ANY($1)
			AND mr.deleted_at IS NULL
			AND ` + excludeWarmupConditionKey + `
			AND (mr.created_at AT TIME ZONE $2)::date = (CURRENT_TIMESTAMP AT TIME ZONE $2)::date
		GROUP BY mr.key
	`
	var todayCountRows []struct {
		Key   string `bun:"key"`
		Count int    `bun:"count"`
	}
	_, err = r.db.NewRaw(todayCountQuery, bun.In(allKeyStrings), timezone).Exec(ctx, &todayCountRows)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}
	todayCountMap := make(map[string]int)
	for _, row := range todayCountRows {
		todayCountMap[row.Key] = row.Count
	}

	// 3. 查询最后使用时间和供应商
	lastUsageQuery := `
		SELECT DISTINCT ON (mr.key)
			mr.key,
			mr.created_at AS last_used_at,
			p.name AS last_provider_name
		FROM message_request mr
		INNER JOIN providers p ON mr.provider_id = p.id
		WHERE mr.key = ANY($1)
			AND mr.deleted_at IS NULL
			AND ` + excludeWarmupConditionKey + `
		ORDER BY mr.key, mr.created_at DESC
	`
	var lastUsageRows []struct {
		Key              string     `bun:"key"`
		LastUsedAt       *time.Time `bun:"last_used_at"`
		LastProviderName *string    `bun:"last_provider_name"`
	}
	_, err = r.db.NewRaw(lastUsageQuery, bun.In(allKeyStrings)).Exec(ctx, &lastUsageRows)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}
	lastUsageMap := make(map[string]struct {
		LastUsedAt       *time.Time
		LastProviderName *string
	})
	for _, row := range lastUsageRows {
		lastUsageMap[row.Key] = struct {
			LastUsedAt       *time.Time
			LastProviderName *string
		}{
			LastUsedAt:       row.LastUsedAt,
			LastProviderName: row.LastProviderName,
		}
	}

	// 4. 查询模型统计
	modelStatsQuery := `
		SELECT
			mr.key,
			mr.model,
			COUNT(*) AS call_count,
			COALESCE(SUM(mr.cost_usd), 0) AS total_cost
		FROM message_request mr
		WHERE mr.key = ANY($1)
			AND mr.deleted_at IS NULL
			AND ` + excludeWarmupConditionKey + `
			AND (mr.created_at AT TIME ZONE $2)::date = (CURRENT_TIMESTAMP AT TIME ZONE $2)::date
			AND mr.model IS NOT NULL
		GROUP BY mr.key, mr.model
		ORDER BY mr.key, COUNT(*) DESC
	`
	var modelStatsRows []struct {
		Key       string           `bun:"key"`
		Model     string           `bun:"model"`
		CallCount int              `bun:"call_count"`
		TotalCost udecimal.Decimal `bun:"total_cost"`
	}
	_, err = r.db.NewRaw(modelStatsQuery, bun.In(allKeyStrings), timezone).Exec(ctx, &modelStatsRows)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}
	modelStatsMap := make(map[string][]*KeyModelStat)
	for _, row := range modelStatsRows {
		modelStatsMap[row.Key] = append(modelStatsMap[row.Key], &KeyModelStat{
			Model:     row.Model,
			CallCount: row.CallCount,
			TotalCost: row.TotalCost,
		})
	}

	// 5. 按用户分组组装结果
	result := make(map[int][]*KeyStatistics)
	for _, userID := range userIDs {
		result[userID] = []*KeyStatistics{}
	}

	for _, userID := range userIDs {
		userKeys := keysMap[userID]
		for _, k := range userKeys {
			lastUsage := lastUsageMap[k.Key]
			stats := &KeyStatistics{
				KeyID:            k.ID,
				TodayCallCount:   todayCountMap[k.Key],
				LastUsedAt:       lastUsage.LastUsedAt,
				LastProviderName: lastUsage.LastProviderName,
				ModelStats:       modelStatsMap[k.Key],
			}
			if stats.ModelStats == nil {
				stats.ModelStats = []*KeyModelStat{}
			}
			result[userID] = append(result[userID], stats)
		}
	}

	return result, nil
}

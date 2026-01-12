package repository

import (
	"context"
	"database/sql"
	"sort"
	"strings"
	"time"

	"github.com/ding113/claude-code-hub/internal/model"
	"github.com/ding113/claude-code-hub/internal/pkg/errors"
	"github.com/uptrace/bun"
)

// UserRepository 用户数据访问接口
type UserRepository interface {
	Repository

	// Create 创建用户
	Create(ctx context.Context, user *model.User) (*model.User, error)

	// GetByID 根据 ID 获取用户
	GetByID(ctx context.Context, id int) (*model.User, error)

	// GetByIDWithKeys 根据 ID 获取用户（包含关联的 Keys）
	GetByIDWithKeys(ctx context.Context, id int) (*model.User, error)

	// Update 更新用户
	Update(ctx context.Context, user *model.User) (*model.User, error)

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

	// SearchUsersForFilter 搜索用户（用于过滤下拉框，返回精简结果）
	SearchUsersForFilter(ctx context.Context, searchTerm string) ([]UserFilterItem, error)

	// FindUserListBatch 批量获取用户（支持复杂筛选）
	FindUserListBatch(ctx context.Context, filters *UserListBatchFilters) (*UserListBatchResult, error)
}

// UserFilterItem 用户过滤下拉框项
type UserFilterItem struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// UserListBatchFilters 用户批量查询筛选条件
type UserListBatchFilters struct {
	Cursor          int      `json:"cursor"`          // Offset pagination cursor
	Limit           int      `json:"limit"`           // Page size (default 50)
	SearchTerm      string   `json:"searchTerm"`      // Search in username / note
	TagFilters      []string `json:"tagFilters"`      // Filter by multiple tags (OR logic)
	KeyGroupFilters []string `json:"keyGroupFilters"` // Filter by provider group
	StatusFilter    string   `json:"statusFilter"`    // all, active, expired, expiringSoon, enabled, disabled
	SortBy          string   `json:"sortBy"`          // name, tags, expiresAt, rpm, limit5hUsd, limitDailyUsd, limitWeeklyUsd, limitMonthlyUsd, createdAt
	SortOrder       string   `json:"sortOrder"`       // asc, desc
}

// UserListBatchResult 用户批量查询结果
type UserListBatchResult struct {
	Users      []*model.User `json:"users"`
	NextCursor *int          `json:"nextCursor"`
	HasMore    bool          `json:"hasMore"`
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
func (r *userRepository) Create(ctx context.Context, user *model.User) (*model.User, error) {
	now := time.Now()
	if user.Role == "" {
		user.Role = "user"
	}
	if user.Tags == nil {
		user.Tags = []string{}
	}
	if user.DailyResetMode == "" {
		user.DailyResetMode = "fixed"
	}
	if user.DailyResetTime == "" {
		user.DailyResetTime = "00:00"
	}
	if user.AllowedClients == nil {
		user.AllowedClients = []string{}
	}
	if user.AllowedModels == nil {
		user.AllowedModels = []string{}
	}
	if user.IsEnabled == nil {
		enabled := true
		user.IsEnabled = &enabled
	}
	user.CreatedAt = now
	user.UpdatedAt = now

	_, err := r.db.NewInsert().
		Model(user).
		Returning("*").
		Exec(ctx)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return user, nil
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

// Update 更新用户（部分更新，忽略零值字段）
func (r *userRepository) Update(ctx context.Context, user *model.User) (*model.User, error) {
	user.UpdatedAt = time.Now()

	result, err := r.db.NewUpdate().
		Model(user).
		WherePK().
		OmitZero().
		Where("deleted_at IS NULL").
		Returning("*").
		Exec(ctx)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return nil, errors.NewNotFoundError("User")
	}

	return user, nil
}

// Delete 删除用户（软删除）
func (r *userRepository) Delete(ctx context.Context, id int) error {
	now := time.Now()
	result, err := r.db.NewUpdate().
		Model((*model.User)(nil)).
		Set("deleted_at = ?", now).
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
		if opts.Pagination != nil {
			opts.Pagination.PageSize = 50
		}
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
		Where("expires_at < ?", now).
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

// GetAllTags 获取所有用户的标签（去重并排序）
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
	sort.Strings(tags)

	return tags, nil
}

// GetAllProviderGroups 获取所有用户的供应商组（去重，支持逗号分隔）
func (r *userRepository) GetAllProviderGroups(ctx context.Context) ([]string, error) {
	var results []struct {
		ProviderGroup *string `bun:"provider_group"`
	}

	err := r.db.NewSelect().
		Model((*model.User)(nil)).
		Column("provider_group").
		Where("deleted_at IS NULL").
		Where("provider_group IS NOT NULL").
		Where("provider_group != ''").
		Scan(ctx, &results)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	// 处理逗号分隔的多值并去重
	groupSet := make(map[string]struct{})
	for _, row := range results {
		if row.ProviderGroup == nil {
			continue
		}
		parts := strings.Split(*row.ProviderGroup, ",")
		for _, part := range parts {
			trimmed := strings.TrimSpace(part)
			if trimmed != "" {
				groupSet[trimmed] = struct{}{}
			}
		}
	}

	groups := make([]string, 0, len(groupSet))
	for group := range groupSet {
		groups = append(groups, group)
	}
	sort.Strings(groups)

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

// SearchUsersForFilter 搜索用户（用于过滤下拉框，返回精简结果）
func (r *userRepository) SearchUsersForFilter(ctx context.Context, searchTerm string) ([]UserFilterItem, error) {
	query := r.db.NewSelect().
		Model((*model.User)(nil)).
		Column("id", "name").
		Where("deleted_at IS NULL")

	// 搜索条件
	trimmedSearchTerm := strings.TrimSpace(searchTerm)
	if trimmedSearchTerm != "" {
		pattern := "%" + trimmedSearchTerm + "%"
		query = query.Where("name ILIKE ?", pattern)
	}

	// 排序：管理员优先，然后按 ID
	query = query.OrderExpr("CASE WHEN role = 'admin' THEN 0 ELSE 1 END, id")

	var results []UserFilterItem
	err := query.Scan(ctx, &results)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return results, nil
}

// FindUserListBatch 批量获取用户（支持复杂筛选）
func (r *userRepository) FindUserListBatch(ctx context.Context, filters *UserListBatchFilters) (*UserListBatchResult, error) {
	if filters == nil {
		filters = &UserListBatchFilters{}
	}

	// 设置默认值
	limit := filters.Limit
	if limit <= 0 {
		limit = 50
	}

	cursor := filters.Cursor
	if cursor < 0 {
		cursor = 0
	}

	sortBy := filters.SortBy
	if sortBy == "" {
		sortBy = "createdAt"
	}

	sortOrder := filters.SortOrder
	if sortOrder == "" {
		sortOrder = "asc"
	}

	query := r.db.NewSelect().Model((*model.User)(nil))

	// 基础条件：未删除
	query = query.Where("deleted_at IS NULL")

	// 搜索条件：在 name, description, provider_group, tags 及关联 keys 中搜索
	trimmedSearch := strings.TrimSpace(filters.SearchTerm)
	if trimmedSearch != "" {
		pattern := "%" + trimmedSearch + "%"
		query = query.Where(`(
			name ILIKE ? OR
			description ILIKE ? OR
			provider_group ILIKE ? OR
			EXISTS (
				SELECT 1 FROM jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb)) AS tag
				WHERE tag ILIKE ?
			) OR
			EXISTS (
				SELECT 1 FROM keys
				WHERE keys.user_id = users.id
					AND keys.deleted_at IS NULL
					AND (
						keys.name ILIKE ? OR
						keys.key ILIKE ? OR
						keys.provider_group ILIKE ?
					)
			)
		)`, pattern, pattern, pattern, pattern, pattern, pattern, pattern)
	}

	// 标签过滤（OR 逻辑）
	normalizedTags := make([]string, 0)
	for _, tag := range filters.TagFilters {
		trimmed := strings.TrimSpace(tag)
		if trimmed != "" {
			normalizedTags = append(normalizedTags, trimmed)
		}
	}

	// 供应商组过滤
	trimmedGroups := make([]string, 0)
	for _, group := range filters.KeyGroupFilters {
		trimmed := strings.TrimSpace(group)
		if trimmed != "" {
			trimmedGroups = append(trimmedGroups, trimmed)
		}
	}

	// 组合标签和供应商组过滤条件（OR 逻辑）
	if len(normalizedTags) > 0 || len(trimmedGroups) > 0 {
		var filterParts []string
		var filterArgs []interface{}

		// 标签条件
		if len(normalizedTags) > 0 {
			for _, tag := range normalizedTags {
				filterParts = append(filterParts, "tags @> ?::jsonb")
				tagJSON := `["` + tag + `"]`
				filterArgs = append(filterArgs, tagJSON)
			}
		}

		// 供应商组条件
		if len(trimmedGroups) > 0 {
			for _, group := range trimmedGroups {
				filterParts = append(filterParts, "? = ANY(regexp_split_to_array(COALESCE(provider_group, ''), '\\s*,\\s*'))")
				filterArgs = append(filterArgs, group)
			}
		}

		if len(filterParts) > 0 {
			combinedFilter := "(" + strings.Join(filterParts, " OR ") + ")"
			query = query.Where(combinedFilter, filterArgs...)
		}
	}

	// 状态过滤
	if filters.StatusFilter != "" && filters.StatusFilter != "all" {
		switch filters.StatusFilter {
		case "active":
			// 用户已启用且未过期或永不过期
			query = query.Where("(expires_at IS NULL OR expires_at >= NOW()) AND is_enabled = true")
		case "expired":
			// 用户已过期
			query = query.Where("expires_at < NOW()")
		case "expiringSoon":
			// 7 天内即将过期
			query = query.Where("expires_at IS NOT NULL AND expires_at >= NOW() AND expires_at <= NOW() + INTERVAL '7 days'")
		case "enabled":
			// 用户已启用（不管是否过期）
			query = query.Where("is_enabled = true")
		case "disabled":
			// 用户已禁用
			query = query.Where("is_enabled = false")
		}
	}

	// 动态排序
	sortColumn := map[string]string{
		"name":            "name",
		"tags":            "tags",
		"expiresAt":       "expires_at",
		"rpm":             "rpm_limit",
		"limit5hUsd":      "limit_5h_usd",
		"limitDailyUsd":   "daily_limit_usd",
		"limitWeeklyUsd":  "limit_weekly_usd",
		"limitMonthlyUsd": "limit_monthly_usd",
		"createdAt":       "created_at",
	}[sortBy]

	if sortColumn == "" {
		sortColumn = "created_at"
	}

	if sortOrder == "desc" {
		query = query.OrderExpr(sortColumn + " DESC, id ASC")
	} else {
		query = query.OrderExpr(sortColumn + " ASC, id ASC")
	}

	// 分页：获取 limit + 1 条记录以判断是否有更多
	fetchLimit := limit + 1
	query = query.Limit(fetchLimit).Offset(cursor)

	var users []*model.User
	err := query.Scan(ctx, &users)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	// 判断是否有更多记录
	hasMore := len(users) > limit
	if hasMore {
		users = users[:limit]
	}

	var nextCursor *int
	if hasMore {
		next := cursor + limit
		nextCursor = &next
	}

	return &UserListBatchResult{
		Users:      users,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
}

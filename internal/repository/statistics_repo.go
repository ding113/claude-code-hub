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

// TimeRange 时间范围类型
type TimeRange string

const (
	TimeRangeToday     TimeRange = "today"
	TimeRange7Days     TimeRange = "7days"
	TimeRange30Days    TimeRange = "30days"
	TimeRangeThisMonth TimeRange = "thisMonth"
)

// UserStatRow 用户统计行
type UserStatRow struct {
	UserID    int              `bun:"user_id"`
	UserName  string           `bun:"user_name"`
	Date      time.Time        `bun:"date"`
	APICalls  int              `bun:"api_calls"`
	TotalCost udecimal.Decimal `bun:"total_cost"`
}

// KeyStatRow Key 统计行
type KeyStatRow struct {
	KeyID     int              `bun:"key_id"`
	KeyName   string           `bun:"key_name"`
	Date      time.Time        `bun:"date"`
	APICalls  int              `bun:"api_calls"`
	TotalCost udecimal.Decimal `bun:"total_cost"`
}

// CostEntry 费用条目（用于滚动窗口恢复）
type CostEntry struct {
	ID        int              `bun:"id"`
	CreatedAt time.Time        `bun:"created_at"`
	CostUSD   udecimal.Decimal `bun:"cost_usd"`
}

// MixedStatistics 混合统计结果
type MixedStatistics struct {
	OwnKeys         []*KeyStatRow
	OthersAggregate []*UserStatRow
}

// ActiveUserItem 活跃用户项（用于下拉选择）
type ActiveUserItem struct {
	ID   int    `bun:"id" json:"id"`
	Name string `bun:"name" json:"name"`
}

// ActiveKeyItem 活跃密钥项（用于下拉选择）
type ActiveKeyItem struct {
	ID   int    `bun:"id" json:"id"`
	Name string `bun:"name" json:"name"`
}

// StatisticsRepository 统计数据访问接口
type StatisticsRepository interface {
	Repository

	// GetUserStatistics 根据时间范围获取用户消费和API调用统计
	GetUserStatistics(ctx context.Context, timeRange TimeRange, timezone string) ([]*UserStatRow, error)

	// GetKeyStatistics 获取指定用户的密钥使用统计
	GetKeyStatistics(ctx context.Context, userID int, timeRange TimeRange, timezone string) ([]*KeyStatRow, error)

	// GetMixedStatistics 获取混合统计（自己密钥明细+其他用户汇总）
	GetMixedStatistics(ctx context.Context, userID int, timeRange TimeRange, timezone string) (*MixedStatistics, error)

	// SumUserCostInTimeRange 查询用户在指定时间范围内的消费总和
	SumUserCostInTimeRange(ctx context.Context, userID int, startTime, endTime time.Time) (udecimal.Decimal, error)

	// SumKeyCostInTimeRange 查询 Key 在指定时间范围内的消费总和
	SumKeyCostInTimeRange(ctx context.Context, keyID int, startTime, endTime time.Time) (udecimal.Decimal, error)

	// SumKeyCostInTimeRangeByKeyString 通过 key 字符串查询消费
	SumKeyCostInTimeRangeByKeyString(ctx context.Context, keyStr string, startTime, endTime time.Time) (udecimal.Decimal, error)

	// SumProviderCostInTimeRange 查询供应商在指定时间范围内的消费总和
	SumProviderCostInTimeRange(ctx context.Context, providerID int, startTime, endTime time.Time) (udecimal.Decimal, error)

	// SumUserTotalCost 查询用户历史总消费（带时间边界优化）
	SumUserTotalCost(ctx context.Context, userID int, maxAgeDays int) (udecimal.Decimal, error)

	// SumKeyTotalCost 查询 Key 历史总消费
	SumKeyTotalCost(ctx context.Context, keyStr string, maxAgeDays int) (udecimal.Decimal, error)

	// SumKeyTotalCostByID 通过 Key ID 查询历史总消费
	SumKeyTotalCostByID(ctx context.Context, keyID int, maxAgeDays int) (udecimal.Decimal, error)

	// SumProviderTotalCost 查询供应商历史总消费（从 resetAt 开始累计）
	SumProviderTotalCost(ctx context.Context, providerID int, resetAt *time.Time) (udecimal.Decimal, error)

	// FindUserCostEntriesInTimeRange 查询用户消费明细（用于滚动窗口恢复）
	FindUserCostEntriesInTimeRange(ctx context.Context, userID int, startTime, endTime time.Time) ([]*CostEntry, error)

	// FindKeyCostEntriesInTimeRange 查询 Key 消费明细
	FindKeyCostEntriesInTimeRange(ctx context.Context, keyID int, startTime, endTime time.Time) ([]*CostEntry, error)

	// FindProviderCostEntriesInTimeRange 查询供应商消费明细
	FindProviderCostEntriesInTimeRange(ctx context.Context, providerID int, startTime, endTime time.Time) ([]*CostEntry, error)

	// GetActiveUsers 获取所有活跃用户列表（用于统计下拉选择）
	GetActiveUsers(ctx context.Context) ([]*ActiveUserItem, error)

	// GetActiveKeysForUser 获取指定用户的有效密钥列表（用于统计下拉选择）
	GetActiveKeysForUser(ctx context.Context, userID int) ([]*ActiveKeyItem, error)
}

// statisticsRepository StatisticsRepository 实现
type statisticsRepository struct {
	*BaseRepository
}

// NewStatisticsRepository 创建 StatisticsRepository
func NewStatisticsRepository(db *bun.DB) StatisticsRepository {
	return &statisticsRepository{
		BaseRepository: NewBaseRepository(db),
	}
}

// excludeWarmupCondition 排除 warmup 请求的条件
const excludeWarmupCondition = "(blocked_by IS NULL OR blocked_by <> 'warmup')"

// GetUserStatistics 根据时间范围获取用户消费和API调用统计
func (r *statisticsRepository) GetUserStatistics(ctx context.Context, timeRange TimeRange, timezone string) ([]*UserStatRow, error) {
	var query string

	switch timeRange {
	case TimeRangeToday:
		query = `
			WITH hour_range AS (
				SELECT generate_series(
					DATE_TRUNC('day', TIMEZONE($1, NOW())),
					DATE_TRUNC('day', TIMEZONE($1, NOW())) + INTERVAL '23 hours',
					'1 hour'::interval
				) AS hour
			),
			hourly_stats AS (
				SELECT
					u.id AS user_id,
					u.name AS user_name,
					hr.hour,
					COUNT(mr.id) AS api_calls,
					COALESCE(SUM(mr.cost_usd), 0) AS total_cost
				FROM users u
				CROSS JOIN hour_range hr
				LEFT JOIN message_request mr ON u.id = mr.user_id
					AND DATE_TRUNC('hour', mr.created_at AT TIME ZONE $1) = hr.hour
					AND mr.deleted_at IS NULL AND ` + excludeWarmupCondition + `
				WHERE u.deleted_at IS NULL
				GROUP BY u.id, u.name, hr.hour
			)
			SELECT
				user_id,
				user_name,
				hour AS date,
				api_calls::integer,
				total_cost::numeric
			FROM hourly_stats
			ORDER BY hour ASC, user_name ASC
		`
	case TimeRange7Days:
		query = `
			WITH date_range AS (
				SELECT generate_series(
					(CURRENT_TIMESTAMP AT TIME ZONE $1)::date - INTERVAL '6 days',
					(CURRENT_TIMESTAMP AT TIME ZONE $1)::date,
					'1 day'::interval
				)::date AS date
			),
			daily_stats AS (
				SELECT
					u.id AS user_id,
					u.name AS user_name,
					dr.date,
					COUNT(mr.id) AS api_calls,
					COALESCE(SUM(mr.cost_usd), 0) AS total_cost
				FROM users u
				CROSS JOIN date_range dr
				LEFT JOIN message_request mr ON u.id = mr.user_id
					AND (mr.created_at AT TIME ZONE $1)::date = dr.date
					AND mr.deleted_at IS NULL AND ` + excludeWarmupCondition + `
				WHERE u.deleted_at IS NULL
				GROUP BY u.id, u.name, dr.date
			)
			SELECT
				user_id,
				user_name,
				date,
				api_calls::integer,
				total_cost::numeric
			FROM daily_stats
			ORDER BY date ASC, user_name ASC
		`
	case TimeRange30Days:
		query = `
			WITH date_range AS (
				SELECT generate_series(
					(CURRENT_TIMESTAMP AT TIME ZONE $1)::date - INTERVAL '29 days',
					(CURRENT_TIMESTAMP AT TIME ZONE $1)::date,
					'1 day'::interval
				)::date AS date
			),
			daily_stats AS (
				SELECT
					u.id AS user_id,
					u.name AS user_name,
					dr.date,
					COUNT(mr.id) AS api_calls,
					COALESCE(SUM(mr.cost_usd), 0) AS total_cost
				FROM users u
				CROSS JOIN date_range dr
				LEFT JOIN message_request mr ON u.id = mr.user_id
					AND (mr.created_at AT TIME ZONE $1)::date = dr.date
					AND mr.deleted_at IS NULL AND ` + excludeWarmupCondition + `
				WHERE u.deleted_at IS NULL
				GROUP BY u.id, u.name, dr.date
			)
			SELECT
				user_id,
				user_name,
				date,
				api_calls::integer,
				total_cost::numeric
			FROM daily_stats
			ORDER BY date ASC, user_name ASC
		`
	case TimeRangeThisMonth:
		query = `
			WITH date_range AS (
				SELECT generate_series(
					DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE $1)::date,
					(CURRENT_TIMESTAMP AT TIME ZONE $1)::date,
					'1 day'::interval
				)::date AS date
			),
			daily_stats AS (
				SELECT
					u.id AS user_id,
					u.name AS user_name,
					dr.date,
					COUNT(mr.id) AS api_calls,
					COALESCE(SUM(mr.cost_usd), 0) AS total_cost
				FROM users u
				CROSS JOIN date_range dr
				LEFT JOIN message_request mr ON u.id = mr.user_id
					AND (mr.created_at AT TIME ZONE $1)::date = dr.date
					AND mr.deleted_at IS NULL AND ` + excludeWarmupCondition + `
				WHERE u.deleted_at IS NULL
				GROUP BY u.id, u.name, dr.date
			)
			SELECT
				user_id,
				user_name,
				date,
				api_calls::integer,
				total_cost::numeric
			FROM daily_stats
			ORDER BY date ASC, user_name ASC
		`
	default:
		return nil, errors.NewInvalidRequest("Unsupported time range: " + string(timeRange))
	}

	var rows []*UserStatRow
	_, err := r.db.NewRaw(query, timezone).Exec(ctx, &rows)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return rows, nil
}

// GetKeyStatistics 获取指定用户的密钥使用统计
func (r *statisticsRepository) GetKeyStatistics(ctx context.Context, userID int, timeRange TimeRange, timezone string) ([]*KeyStatRow, error) {
	var query string

	switch timeRange {
	case TimeRangeToday:
		query = `
			WITH hour_range AS (
				SELECT generate_series(
					DATE_TRUNC('day', TIMEZONE($1, NOW())),
					DATE_TRUNC('day', TIMEZONE($1, NOW())) + INTERVAL '23 hours',
					'1 hour'::interval
				) AS hour
			),
			user_keys AS (
				SELECT id, name, key
				FROM keys
				WHERE user_id = $2
					AND deleted_at IS NULL
			),
			hourly_stats AS (
				SELECT
					k.id AS key_id,
					k.name AS key_name,
					hr.hour,
					COUNT(mr.id) AS api_calls,
					COALESCE(SUM(mr.cost_usd), 0) AS total_cost
				FROM user_keys k
				CROSS JOIN hour_range hr
				LEFT JOIN message_request mr ON mr.key = k.key
					AND mr.user_id = $2
					AND DATE_TRUNC('hour', mr.created_at AT TIME ZONE $1) = hr.hour
					AND mr.deleted_at IS NULL AND ` + excludeWarmupCondition + `
				GROUP BY k.id, k.name, hr.hour
			)
			SELECT
				key_id,
				key_name,
				hour AS date,
				api_calls::integer,
				total_cost::numeric
			FROM hourly_stats
			ORDER BY hour ASC, key_name ASC
		`
	case TimeRange7Days:
		query = `
			WITH date_range AS (
				SELECT generate_series(
					(CURRENT_TIMESTAMP AT TIME ZONE $1)::date - INTERVAL '6 days',
					(CURRENT_TIMESTAMP AT TIME ZONE $1)::date,
					'1 day'::interval
				)::date AS date
			),
			user_keys AS (
				SELECT id, name, key
				FROM keys
				WHERE user_id = $2
					AND deleted_at IS NULL
			),
			daily_stats AS (
				SELECT
					k.id AS key_id,
					k.name AS key_name,
					dr.date,
					COUNT(mr.id) AS api_calls,
					COALESCE(SUM(mr.cost_usd), 0) AS total_cost
				FROM user_keys k
				CROSS JOIN date_range dr
				LEFT JOIN message_request mr ON mr.key = k.key
					AND mr.user_id = $2
					AND (mr.created_at AT TIME ZONE $1)::date = dr.date
					AND mr.deleted_at IS NULL AND ` + excludeWarmupCondition + `
				GROUP BY k.id, k.name, dr.date
			)
			SELECT
				key_id,
				key_name,
				date,
				api_calls::integer,
				total_cost::numeric
			FROM daily_stats
			ORDER BY date ASC, key_name ASC
		`
	case TimeRange30Days:
		query = `
			WITH date_range AS (
				SELECT generate_series(
					(CURRENT_TIMESTAMP AT TIME ZONE $1)::date - INTERVAL '29 days',
					(CURRENT_TIMESTAMP AT TIME ZONE $1)::date,
					'1 day'::interval
				)::date AS date
			),
			user_keys AS (
				SELECT id, name, key
				FROM keys
				WHERE user_id = $2
					AND deleted_at IS NULL
			),
			daily_stats AS (
				SELECT
					k.id AS key_id,
					k.name AS key_name,
					dr.date,
					COUNT(mr.id) AS api_calls,
					COALESCE(SUM(mr.cost_usd), 0) AS total_cost
				FROM user_keys k
				CROSS JOIN date_range dr
				LEFT JOIN message_request mr ON mr.key = k.key
					AND mr.user_id = $2
					AND (mr.created_at AT TIME ZONE $1)::date = dr.date
					AND mr.deleted_at IS NULL AND ` + excludeWarmupCondition + `
				GROUP BY k.id, k.name, dr.date
			)
			SELECT
				key_id,
				key_name,
				date,
				api_calls::integer,
				total_cost::numeric
			FROM daily_stats
			ORDER BY date ASC, key_name ASC
		`
	case TimeRangeThisMonth:
		query = `
			WITH date_range AS (
				SELECT generate_series(
					DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE $1)::date,
					(CURRENT_TIMESTAMP AT TIME ZONE $1)::date,
					'1 day'::interval
				)::date AS date
			),
			user_keys AS (
				SELECT id, name, key
				FROM keys
				WHERE user_id = $2
					AND deleted_at IS NULL
			),
			daily_stats AS (
				SELECT
					k.id AS key_id,
					k.name AS key_name,
					dr.date,
					COUNT(mr.id) AS api_calls,
					COALESCE(SUM(mr.cost_usd), 0) AS total_cost
				FROM user_keys k
				CROSS JOIN date_range dr
				LEFT JOIN message_request mr ON mr.key = k.key
					AND mr.user_id = $2
					AND (mr.created_at AT TIME ZONE $1)::date = dr.date
					AND mr.deleted_at IS NULL AND ` + excludeWarmupCondition + `
				GROUP BY k.id, k.name, dr.date
			)
			SELECT
				key_id,
				key_name,
				date,
				api_calls::integer,
				total_cost::numeric
			FROM daily_stats
			ORDER BY date ASC, key_name ASC
		`
	default:
		return nil, errors.NewInvalidRequest("Unsupported time range: " + string(timeRange))
	}

	var rows []*KeyStatRow
	_, err := r.db.NewRaw(query, timezone, userID).Exec(ctx, &rows)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return rows, nil
}

// GetMixedStatistics 获取混合统计（自己密钥明细+其他用户汇总）
func (r *statisticsRepository) GetMixedStatistics(ctx context.Context, userID int, timeRange TimeRange, timezone string) (*MixedStatistics, error) {
	ownKeys, err := r.GetKeyStatistics(ctx, userID, timeRange, timezone)
	if err != nil {
		return nil, err
	}

	var othersQuery string

	switch timeRange {
	case TimeRangeToday:
		othersQuery = `
			WITH hour_range AS (
				SELECT generate_series(
					DATE_TRUNC('day', TIMEZONE($1, NOW())),
					DATE_TRUNC('day', TIMEZONE($1, NOW())) + INTERVAL '23 hours',
					'1 hour'::interval
				) AS hour
			),
			hourly_stats AS (
				SELECT
					hr.hour,
					COUNT(mr.id) AS api_calls,
					COALESCE(SUM(mr.cost_usd), 0) AS total_cost
				FROM hour_range hr
				LEFT JOIN message_request mr ON DATE_TRUNC('hour', mr.created_at AT TIME ZONE $1) = hr.hour
					AND mr.user_id != $2
					AND mr.deleted_at IS NULL AND ` + excludeWarmupCondition + `
				GROUP BY hr.hour
			)
			SELECT
				-1 AS user_id,
				'其他用户' AS user_name,
				hour AS date,
				api_calls::integer,
				total_cost::numeric
			FROM hourly_stats
			ORDER BY hour ASC
		`
	case TimeRange7Days:
		othersQuery = `
			WITH date_range AS (
				SELECT generate_series(
					(CURRENT_TIMESTAMP AT TIME ZONE $1)::date - INTERVAL '6 days',
					(CURRENT_TIMESTAMP AT TIME ZONE $1)::date,
					'1 day'::interval
				)::date AS date
			),
			daily_stats AS (
				SELECT
					dr.date,
					COUNT(mr.id) AS api_calls,
					COALESCE(SUM(mr.cost_usd), 0) AS total_cost
				FROM date_range dr
				LEFT JOIN message_request mr ON (mr.created_at AT TIME ZONE $1)::date = dr.date
					AND mr.user_id != $2
					AND mr.deleted_at IS NULL AND ` + excludeWarmupCondition + `
				GROUP BY dr.date
			)
			SELECT
				-1 AS user_id,
				'其他用户' AS user_name,
				date,
				api_calls::integer,
				total_cost::numeric
			FROM daily_stats
			ORDER BY date ASC
		`
	case TimeRange30Days:
		othersQuery = `
			WITH date_range AS (
				SELECT generate_series(
					(CURRENT_TIMESTAMP AT TIME ZONE $1)::date - INTERVAL '29 days',
					(CURRENT_TIMESTAMP AT TIME ZONE $1)::date,
					'1 day'::interval
				)::date AS date
			),
			daily_stats AS (
				SELECT
					dr.date,
					COUNT(mr.id) AS api_calls,
					COALESCE(SUM(mr.cost_usd), 0) AS total_cost
				FROM date_range dr
				LEFT JOIN message_request mr ON (mr.created_at AT TIME ZONE $1)::date = dr.date
					AND mr.user_id != $2
					AND mr.deleted_at IS NULL AND ` + excludeWarmupCondition + `
				GROUP BY dr.date
			)
			SELECT
				-1 AS user_id,
				'其他用户' AS user_name,
				date,
				api_calls::integer,
				total_cost::numeric
			FROM daily_stats
			ORDER BY date ASC
		`
	case TimeRangeThisMonth:
		othersQuery = `
			WITH date_range AS (
				SELECT generate_series(
					DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE $1)::date,
					(CURRENT_TIMESTAMP AT TIME ZONE $1)::date,
					'1 day'::interval
				)::date AS date
			),
			daily_stats AS (
				SELECT
					dr.date,
					COUNT(mr.id) AS api_calls,
					COALESCE(SUM(mr.cost_usd), 0) AS total_cost
				FROM date_range dr
				LEFT JOIN message_request mr ON (mr.created_at AT TIME ZONE $1)::date = dr.date
					AND mr.user_id != $2
					AND mr.deleted_at IS NULL AND ` + excludeWarmupCondition + `
				GROUP BY dr.date
			)
			SELECT
				-1 AS user_id,
				'其他用户' AS user_name,
				date,
				api_calls::integer,
				total_cost::numeric
			FROM daily_stats
			ORDER BY date ASC
		`
	default:
		return nil, errors.NewInvalidRequest("Unsupported time range: " + string(timeRange))
	}

	var othersAggregate []*UserStatRow
	_, err = r.db.NewRaw(othersQuery, timezone, userID).Exec(ctx, &othersAggregate)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return &MixedStatistics{
		OwnKeys:         ownKeys,
		OthersAggregate: othersAggregate,
	}, nil
}

// SumUserCostInTimeRange 查询用户在指定时间范围内的消费总和
func (r *statisticsRepository) SumUserCostInTimeRange(ctx context.Context, userID int, startTime, endTime time.Time) (udecimal.Decimal, error) {
	var result struct {
		Total udecimal.Decimal `bun:"total"`
	}

	err := r.db.NewSelect().
		Model((*model.MessageRequest)(nil)).
		ColumnExpr("COALESCE(SUM(cost_usd), 0) AS total").
		Where("user_id = ?", userID).
		Where("created_at >= ?", startTime).
		Where("created_at < ?", endTime).
		Where("deleted_at IS NULL").
		Where(excludeWarmupCondition).
		Scan(ctx, &result)

	if err != nil {
		return udecimal.Zero, errors.NewDatabaseError(err)
	}

	return result.Total, nil
}

// SumKeyCostInTimeRange 查询 Key 在指定时间范围内的消费总和
func (r *statisticsRepository) SumKeyCostInTimeRange(ctx context.Context, keyID int, startTime, endTime time.Time) (udecimal.Decimal, error) {
	// 先查询 key 字符串
	var keyRecord struct {
		Key string `bun:"key"`
	}
	err := r.db.NewSelect().
		Model((*model.Key)(nil)).
		Column("key").
		Where("id = ?", keyID).
		Scan(ctx, &keyRecord)

	if err != nil {
		if err == sql.ErrNoRows {
			return udecimal.Zero, nil
		}
		return udecimal.Zero, errors.NewDatabaseError(err)
	}

	return r.SumKeyCostInTimeRangeByKeyString(ctx, keyRecord.Key, startTime, endTime)
}

// SumKeyCostInTimeRangeByKeyString 通过 key 字符串查询消费
func (r *statisticsRepository) SumKeyCostInTimeRangeByKeyString(ctx context.Context, keyStr string, startTime, endTime time.Time) (udecimal.Decimal, error) {
	var result struct {
		Total udecimal.Decimal `bun:"total"`
	}

	err := r.db.NewSelect().
		Model((*model.MessageRequest)(nil)).
		ColumnExpr("COALESCE(SUM(cost_usd), 0) AS total").
		Where("key = ?", keyStr).
		Where("created_at >= ?", startTime).
		Where("created_at < ?", endTime).
		Where("deleted_at IS NULL").
		Where(excludeWarmupCondition).
		Scan(ctx, &result)

	if err != nil {
		return udecimal.Zero, errors.NewDatabaseError(err)
	}

	return result.Total, nil
}

// SumProviderCostInTimeRange 查询供应商在指定时间范围内的消费总和
func (r *statisticsRepository) SumProviderCostInTimeRange(ctx context.Context, providerID int, startTime, endTime time.Time) (udecimal.Decimal, error) {
	var result struct {
		Total udecimal.Decimal `bun:"total"`
	}

	err := r.db.NewSelect().
		Model((*model.MessageRequest)(nil)).
		ColumnExpr("COALESCE(SUM(cost_usd), 0) AS total").
		Where("provider_id = ?", providerID).
		Where("created_at >= ?", startTime).
		Where("created_at < ?", endTime).
		Where("deleted_at IS NULL").
		Where(excludeWarmupCondition).
		Scan(ctx, &result)

	if err != nil {
		return udecimal.Zero, errors.NewDatabaseError(err)
	}

	return result.Total, nil
}

// SumUserTotalCost 查询用户历史总消费
func (r *statisticsRepository) SumUserTotalCost(ctx context.Context, userID int, maxAgeDays int) (udecimal.Decimal, error) {
	if maxAgeDays <= 0 {
		maxAgeDays = 365
	}

	cutoffDate := time.Now().AddDate(0, 0, -maxAgeDays)

	var result struct {
		Total udecimal.Decimal `bun:"total"`
	}

	err := r.db.NewSelect().
		Model((*model.MessageRequest)(nil)).
		ColumnExpr("COALESCE(SUM(cost_usd), 0) AS total").
		Where("user_id = ?", userID).
		Where("created_at >= ?", cutoffDate).
		Where("deleted_at IS NULL").
		Where(excludeWarmupCondition).
		Scan(ctx, &result)

	if err != nil {
		return udecimal.Zero, errors.NewDatabaseError(err)
	}

	return result.Total, nil
}

// SumKeyTotalCost 查询 Key 历史总消费
func (r *statisticsRepository) SumKeyTotalCost(ctx context.Context, keyStr string, maxAgeDays int) (udecimal.Decimal, error) {
	if maxAgeDays <= 0 {
		maxAgeDays = 365
	}

	cutoffDate := time.Now().AddDate(0, 0, -maxAgeDays)

	var result struct {
		Total udecimal.Decimal `bun:"total"`
	}

	err := r.db.NewSelect().
		Model((*model.MessageRequest)(nil)).
		ColumnExpr("COALESCE(SUM(cost_usd), 0) AS total").
		Where("key = ?", keyStr).
		Where("created_at >= ?", cutoffDate).
		Where("deleted_at IS NULL").
		Where(excludeWarmupCondition).
		Scan(ctx, &result)

	if err != nil {
		return udecimal.Zero, errors.NewDatabaseError(err)
	}

	return result.Total, nil
}

// SumProviderTotalCost 查询供应商历史总消费
func (r *statisticsRepository) SumProviderTotalCost(ctx context.Context, providerID int, resetAt *time.Time) (udecimal.Decimal, error) {
	var result struct {
		Total udecimal.Decimal `bun:"total"`
	}

	query := r.db.NewSelect().
		Model((*model.MessageRequest)(nil)).
		ColumnExpr("COALESCE(SUM(cost_usd), 0) AS total").
		Where("provider_id = ?", providerID).
		Where("deleted_at IS NULL").
		Where(excludeWarmupCondition)

	if resetAt != nil && !resetAt.IsZero() {
		query = query.Where("created_at >= ?", *resetAt)
	}

	err := query.Scan(ctx, &result)
	if err != nil {
		return udecimal.Zero, errors.NewDatabaseError(err)
	}

	return result.Total, nil
}

// FindUserCostEntriesInTimeRange 查询用户消费明细
func (r *statisticsRepository) FindUserCostEntriesInTimeRange(ctx context.Context, userID int, startTime, endTime time.Time) ([]*CostEntry, error) {
	var entries []*CostEntry

	err := r.db.NewSelect().
		Model((*model.MessageRequest)(nil)).
		Column("id", "created_at", "cost_usd").
		Where("user_id = ?", userID).
		Where("created_at >= ?", startTime).
		Where("created_at < ?", endTime).
		Where("deleted_at IS NULL").
		Where(excludeWarmupCondition).
		Where("cost_usd > 0").
		Scan(ctx, &entries)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return entries, nil
}

// FindKeyCostEntriesInTimeRange 查询 Key 消费明细
func (r *statisticsRepository) FindKeyCostEntriesInTimeRange(ctx context.Context, keyID int, startTime, endTime time.Time) ([]*CostEntry, error) {
	// 先查询 key 字符串
	var keyRecord struct {
		Key string `bun:"key"`
	}
	err := r.db.NewSelect().
		Model((*model.Key)(nil)).
		Column("key").
		Where("id = ?", keyID).
		Scan(ctx, &keyRecord)

	if err != nil {
		if err == sql.ErrNoRows {
			return []*CostEntry{}, nil
		}
		return nil, errors.NewDatabaseError(err)
	}

	var entries []*CostEntry
	err = r.db.NewSelect().
		Model((*model.MessageRequest)(nil)).
		Column("id", "created_at", "cost_usd").
		Where("key = ?", keyRecord.Key).
		Where("created_at >= ?", startTime).
		Where("created_at < ?", endTime).
		Where("deleted_at IS NULL").
		Where(excludeWarmupCondition).
		Where("cost_usd > 0").
		Scan(ctx, &entries)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return entries, nil
}

// FindProviderCostEntriesInTimeRange 查询供应商消费明细
func (r *statisticsRepository) FindProviderCostEntriesInTimeRange(ctx context.Context, providerID int, startTime, endTime time.Time) ([]*CostEntry, error) {
	var entries []*CostEntry

	err := r.db.NewSelect().
		Model((*model.MessageRequest)(nil)).
		Column("id", "created_at", "cost_usd").
		Where("provider_id = ?", providerID).
		Where("created_at >= ?", startTime).
		Where("created_at < ?", endTime).
		Where("deleted_at IS NULL").
		Where(excludeWarmupCondition).
		Where("cost_usd > 0").
		Scan(ctx, &entries)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return entries, nil
}

// SumKeyTotalCostByID 通过 Key ID 查询历史总消费
func (r *statisticsRepository) SumKeyTotalCostByID(ctx context.Context, keyID int, maxAgeDays int) (udecimal.Decimal, error) {
	// 先查询 key 字符串
	var keyRecord struct {
		Key string `bun:"key"`
	}
	err := r.db.NewSelect().
		Model((*model.Key)(nil)).
		Column("key").
		Where("id = ?", keyID).
		Scan(ctx, &keyRecord)

	if err != nil {
		if err == sql.ErrNoRows {
			return udecimal.Zero, nil
		}
		return udecimal.Zero, errors.NewDatabaseError(err)
	}

	return r.SumKeyTotalCost(ctx, keyRecord.Key, maxAgeDays)
}

// GetActiveUsers 获取所有活跃用户列表（用于统计下拉选择）
func (r *statisticsRepository) GetActiveUsers(ctx context.Context) ([]*ActiveUserItem, error) {
	var users []*ActiveUserItem

	err := r.db.NewSelect().
		Model((*model.User)(nil)).
		Column("id", "name").
		Where("deleted_at IS NULL").
		Order("name ASC").
		Scan(ctx, &users)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return users, nil
}

// GetActiveKeysForUser 获取指定用户的有效密钥列表（用于统计下拉选择）
func (r *statisticsRepository) GetActiveKeysForUser(ctx context.Context, userID int) ([]*ActiveKeyItem, error) {
	var keys []*ActiveKeyItem

	err := r.db.NewSelect().
		Model((*model.Key)(nil)).
		Column("id", "name").
		Where("user_id = ?", userID).
		Where("deleted_at IS NULL").
		Order("name ASC").
		Scan(ctx, &keys)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return keys, nil
}

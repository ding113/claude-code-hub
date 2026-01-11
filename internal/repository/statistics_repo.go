package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
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

// RateLimitEventFilters 限流事件过滤条件
type RateLimitEventFilters struct {
	UserID     *int       // 用户ID过滤
	ProviderID *int       // 供应商ID过滤
	LimitType  *string    // 限流类型过滤
	StartTime  *time.Time // 开始时间
	EndTime    *time.Time // 结束时间
	KeyID      *int       // Key ID过滤
}

// RateLimitEventStats 限流事件统计结果
type RateLimitEventStats struct {
	TotalEvents      int              `json:"total_events"`
	EventsByType     map[string]int   `json:"events_by_type"`
	EventsByUser     map[int]int      `json:"events_by_user"`
	EventsByProvider map[int]int      `json:"events_by_provider"`
	EventsTimeline   []TimelineEntry  `json:"events_timeline"`
	AvgCurrentUsage  udecimal.Decimal `json:"avg_current_usage"`
}

// TimelineEntry 时间线条目
type TimelineEntry struct {
	Hour  string `json:"hour"`
	Count int    `json:"count"`
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

	// GetRateLimitEventStats 获取限流事件统计数据
	GetRateLimitEventStats(ctx context.Context, filters *RateLimitEventFilters, timezone string) (*RateLimitEventStats, error)
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
//
// 注意：此方法保留原始 SQL，原因如下：
// 1. 使用 PostgreSQL 特有的 generate_series 函数生成时间序列
// 2. 涉及复杂的时区转换（AT TIME ZONE）
// 3. 使用 CROSS JOIN 填充零值时间点
// 4. 这些功能在 Bun 查询构建器中难以表达
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
//
// 注意：此方法保留原始 SQL，原因同 GetUserStatistics
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
// 性能优化：使用 goroutine 并行执行两个查询
//
// 注意：此方法保留原始 SQL，原因同 GetUserStatistics
func (r *statisticsRepository) GetMixedStatistics(ctx context.Context, userID int, timeRange TimeRange, timezone string) (*MixedStatistics, error) {
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

	// 使用 channel 进行并行查询
	type keyStatsResult struct {
		data []*KeyStatRow
		err  error
	}
	type othersResult struct {
		data []*UserStatRow
		err  error
	}

	keyStatsCh := make(chan keyStatsResult, 1)
	othersCh := make(chan othersResult, 1)

	// 并行查询自己的密钥统计
	go func() {
		ownKeys, err := r.GetKeyStatistics(ctx, userID, timeRange, timezone)
		keyStatsCh <- keyStatsResult{data: ownKeys, err: err}
	}()

	// 并行查询其他用户汇总
	go func() {
		var othersAggregate []*UserStatRow
		_, err := r.db.NewRaw(othersQuery, timezone, userID).Exec(ctx, &othersAggregate)
		if err != nil {
			othersCh <- othersResult{err: errors.NewDatabaseError(err)}
			return
		}
		othersCh <- othersResult{data: othersAggregate}
	}()

	// 等待两个查询完成
	keyStatsRes := <-keyStatsCh
	othersRes := <-othersCh

	// 检查错误
	if keyStatsRes.err != nil {
		return nil, keyStatsRes.err
	}
	if othersRes.err != nil {
		return nil, othersRes.err
	}

	return &MixedStatistics{
		OwnKeys:         keyStatsRes.data,
		OthersAggregate: othersRes.data,
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

// GetRateLimitEventStats 获取限流事件统计数据
// 查询 message_request 表中包含 rate_limit_metadata 的错误记录
func (r *statisticsRepository) GetRateLimitEventStats(ctx context.Context, filters *RateLimitEventFilters, timezone string) (*RateLimitEventStats, error) {
	if filters == nil {
		filters = &RateLimitEventFilters{}
	}

	// 如果指定了 KeyID，先查询 key 字符串
	var keyString *string
	if filters.KeyID != nil {
		var keyRecord struct {
			Key string `bun:"key"`
		}
		err := r.db.NewSelect().
			Model((*model.Key)(nil)).
			Column("key").
			Where("id = ?", *filters.KeyID).
			Scan(ctx, &keyRecord)
		if err != nil {
			if err == sql.ErrNoRows {
				// Key 不存在，返回空统计
				return &RateLimitEventStats{
					TotalEvents:      0,
					EventsByType:     make(map[string]int),
					EventsByUser:     make(map[int]int),
					EventsByProvider: make(map[int]int),
					EventsTimeline:   []TimelineEntry{},
					AvgCurrentUsage:  udecimal.Zero,
				}, nil
			}
			return nil, errors.NewDatabaseError(err)
		}
		keyString = &keyRecord.Key
	}

	// 构建查询
	query := r.db.NewSelect().
		Model((*model.MessageRequest)(nil)).
		Column("id", "user_id", "provider_id", "error_message").
		ColumnExpr("DATE_TRUNC('hour', created_at AT TIME ZONE ?) AS hour", timezone).
		Where("error_message LIKE '%rate_limit_metadata%'").
		Where("deleted_at IS NULL").
		Order("created_at ASC")

	if filters.UserID != nil {
		query = query.Where("user_id = ?", *filters.UserID)
	}
	if filters.ProviderID != nil {
		query = query.Where("provider_id = ?", *filters.ProviderID)
	}
	if filters.StartTime != nil {
		query = query.Where("created_at >= ?", *filters.StartTime)
	}
	if filters.EndTime != nil {
		query = query.Where("created_at <= ?", *filters.EndTime)
	}
	if keyString != nil {
		query = query.Where("key = ?", *keyString)
	}

	var rows []struct {
		ID           int       `bun:"id"`
		UserID       int       `bun:"user_id"`
		ProviderID   int       `bun:"provider_id"`
		ErrorMessage *string   `bun:"error_message"`
		Hour         time.Time `bun:"hour"`
	}
	err := query.Scan(ctx, &rows)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	totalEvents := len(rows)

	// 初始化聚合数据
	eventsByType := make(map[string]int)
	eventsByUser := make(map[int]int)
	eventsByProvider := make(map[int]int)
	eventsByHour := make(map[string]int)
	var totalCurrentUsage udecimal.Decimal
	usageCount := 0

	// 处理每条记录
	for _, row := range rows {
		if row.ErrorMessage == nil {
			continue
		}

		// 解析 rate_limit_metadata JSON
		metadata, err := parseRateLimitMetadata(*row.ErrorMessage)
		if err != nil || metadata == nil {
			continue
		}

		// 如果指定了 limit_type 过滤，跳过不匹配的记录
		if filters.LimitType != nil && metadata.LimitType != *filters.LimitType {
			continue
		}

		// 按类型统计
		if metadata.LimitType != "" {
			eventsByType[metadata.LimitType]++
		}

		// 按用户统计
		eventsByUser[row.UserID]++

		// 按供应商统计
		eventsByProvider[row.ProviderID]++

		// 按小时统计
		hourKey := row.Hour.UTC().Format(time.RFC3339)
		eventsByHour[hourKey]++

		// 累计当前使用量
		if metadata.Current != nil {
			totalCurrentUsage = totalCurrentUsage.Add(*metadata.Current)
			usageCount++
		}
	}

	// 计算平均当前使用量
	var avgCurrentUsage udecimal.Decimal
	if usageCount > 0 {
		divisor, _ := udecimal.NewFromInt64(int64(usageCount), 0)
		avgCurrentUsage, _ = totalCurrentUsage.Div(divisor)
		avgCurrentUsage = avgCurrentUsage.RoundHAZ(2)
	}

	// 构建时间线数组（按时间排序）
	eventsTimeline := make([]TimelineEntry, 0, len(eventsByHour))
	for hour, count := range eventsByHour {
		eventsTimeline = append(eventsTimeline, TimelineEntry{
			Hour:  hour,
			Count: count,
		})
	}
	// 按时间排序
	sortTimelineEntries(eventsTimeline)

	return &RateLimitEventStats{
		TotalEvents:      totalEvents,
		EventsByType:     eventsByType,
		EventsByUser:     eventsByUser,
		EventsByProvider: eventsByProvider,
		EventsTimeline:   eventsTimeline,
		AvgCurrentUsage:  avgCurrentUsage,
	}, nil
}

// rateLimitMetadata 解析后的限流元数据
type rateLimitMetadata struct {
	LimitType string            `json:"limit_type"`
	Current   *udecimal.Decimal `json:"current"`
}

var rateLimitMetadataRegexp = regexp.MustCompile(`rate_limit_metadata:\s*(\{[^}]+\})`)

// parseRateLimitMetadata 从错误消息中解析限流元数据
func parseRateLimitMetadata(errorMessage string) (*rateLimitMetadata, error) {
	matches := rateLimitMetadataRegexp.FindStringSubmatch(errorMessage)
	if len(matches) < 2 {
		return nil, nil
	}

	var payload struct {
		LimitType string      `json:"limit_type"`
		Current   json.Number `json:"current"`
	}
	if err := json.Unmarshal([]byte(matches[1]), &payload); err != nil {
		return nil, nil
	}

	metadata := &rateLimitMetadata{LimitType: payload.LimitType}
	if payload.Current != "" {
		if d, err := udecimal.Parse(payload.Current.String()); err == nil {
			metadata.Current = &d
		}
	}

	return metadata, nil
}

// findSubstring 查找子串位置
func findSubstring(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

// extractStringValue 从 "key": "value" 格式中提取值
func extractStringValue(s string) string {
	// 跳过 key 和冒号
	colonIdx := findSubstring(s, ":")
	if colonIdx == -1 {
		return ""
	}
	s = s[colonIdx+1:]

	// 跳过空白
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t') {
		s = s[1:]
	}

	// 检查引号
	if len(s) == 0 || s[0] != '"' {
		return ""
	}
	s = s[1:]

	// 找到结束引号
	endIdx := 0
	for endIdx < len(s) && s[endIdx] != '"' {
		endIdx++
	}
	if endIdx >= len(s) {
		return ""
	}

	return s[:endIdx]
}

// extractNumberValue 从 "key": number 格式中提取数值
func extractNumberValue(s string) string {
	// 跳过 key 和冒号
	colonIdx := findSubstring(s, ":")
	if colonIdx == -1 {
		return ""
	}
	s = s[colonIdx+1:]

	// 跳过空白
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t') {
		s = s[1:]
	}

	// 提取数字
	endIdx := 0
	for endIdx < len(s) && (s[endIdx] >= '0' && s[endIdx] <= '9' || s[endIdx] == '.' || s[endIdx] == '-') {
		endIdx++
	}
	if endIdx == 0 {
		return ""
	}

	return s[:endIdx]
}

// sortTimelineEntries 按时间排序时间线条目
func sortTimelineEntries(entries []TimelineEntry) {
	for i := 0; i < len(entries)-1; i++ {
		for j := i + 1; j < len(entries); j++ {
			if entries[i].Hour > entries[j].Hour {
				entries[i], entries[j] = entries[j], entries[i]
			}
		}
	}
}

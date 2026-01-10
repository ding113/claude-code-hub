package repository

import (
	"context"
	"database/sql"
	"time"

	"github.com/ding113/claude-code-hub/internal/model"
	"github.com/ding113/claude-code-hub/internal/pkg/errors"
	"github.com/uptrace/bun"
)

// ModelPriceRepository 模型价格数据访问接口
type ModelPriceRepository interface {
	Repository

	// Create 创建模型价格记录
	Create(ctx context.Context, price *model.ModelPrice) error

	// GetByID 根据 ID 获取价格记录
	GetByID(ctx context.Context, id int) (*model.ModelPrice, error)

	// GetLatestByModelName 获取指定模型的最新价格
	GetLatestByModelName(ctx context.Context, modelName string) (*model.ModelPrice, error)

	// ListAllLatestPrices 获取所有模型的最新价格（非分页）
	ListAllLatestPrices(ctx context.Context) ([]*model.ModelPrice, error)

	// ListAllLatestPricesPaginated 分页获取所有模型的最新价格
	ListAllLatestPricesPaginated(ctx context.Context, page, pageSize int, search string) (*PaginatedPrices, error)

	// HasAnyRecords 检查是否存在任意价格记录
	HasAnyRecords(ctx context.Context) (bool, error)

	// GetAllModelNames 获取所有模型名称（用于模型选择）
	GetAllModelNames(ctx context.Context) ([]string, error)

	// GetChatModelNames 获取所有聊天模型名称
	GetChatModelNames(ctx context.Context) ([]string, error)
}

// PaginatedPrices 分页价格结果
type PaginatedPrices struct {
	Data       []*model.ModelPrice
	Total      int
	Page       int
	PageSize   int
	TotalPages int
}

// modelPriceRepository ModelPriceRepository 实现
type modelPriceRepository struct {
	*BaseRepository
}

// NewModelPriceRepository 创建 ModelPriceRepository
func NewModelPriceRepository(db *bun.DB) ModelPriceRepository {
	return &modelPriceRepository{
		BaseRepository: NewBaseRepository(db),
	}
}

// Create 创建模型价格记录
func (r *modelPriceRepository) Create(ctx context.Context, price *model.ModelPrice) error {
	now := time.Now()
	price.CreatedAt = now
	price.UpdatedAt = now

	_, err := r.db.NewInsert().
		Model(price).
		Exec(ctx)

	if err != nil {
		return errors.NewDatabaseError(err)
	}

	return nil
}

// GetByID 根据 ID 获取价格记录
func (r *modelPriceRepository) GetByID(ctx context.Context, id int) (*model.ModelPrice, error) {
	price := new(model.ModelPrice)
	err := r.db.NewSelect().
		Model(price).
		Where("id = ?", id).
		Scan(ctx)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.NewNotFoundError("ModelPrice")
		}
		return nil, errors.NewDatabaseError(err)
	}

	return price, nil
}

// GetLatestByModelName 获取指定模型的最新价格
func (r *modelPriceRepository) GetLatestByModelName(ctx context.Context, modelName string) (*model.ModelPrice, error) {
	price := new(model.ModelPrice)
	err := r.db.NewSelect().
		Model(price).
		Where("model_name = ?", modelName).
		Order("created_at DESC").
		Limit(1).
		Scan(ctx)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.NewNotFoundError("ModelPrice")
		}
		return nil, errors.NewDatabaseError(err)
	}

	return price, nil
}

// ListAllLatestPrices 获取所有模型的最新价格
func (r *modelPriceRepository) ListAllLatestPrices(ctx context.Context) ([]*model.ModelPrice, error) {
	// 使用窗口函数获取每个模型的最新价格
	query := `
		WITH latest_prices AS (
			SELECT
				model_name,
				MAX(created_at) as max_created_at
			FROM model_prices
			GROUP BY model_name
		),
		latest_records AS (
			SELECT
				mp.id,
				mp.model_name,
				mp.price_data,
				mp.created_at,
				mp.updated_at,
				ROW_NUMBER() OVER (PARTITION BY mp.model_name ORDER BY mp.id DESC) as rn
			FROM model_prices mp
			INNER JOIN latest_prices lp
				ON mp.model_name = lp.model_name
				AND mp.created_at = lp.max_created_at
		)
		SELECT
			id,
			model_name,
			price_data,
			created_at,
			updated_at
		FROM latest_records
		WHERE rn = 1
		ORDER BY model_name
	`

	var prices []*model.ModelPrice
	_, err := r.db.NewRaw(query).Exec(ctx, &prices)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return prices, nil
}

// ListAllLatestPricesPaginated 分页获取所有模型的最新价格
func (r *modelPriceRepository) ListAllLatestPricesPaginated(ctx context.Context, page, pageSize int, search string) (*PaginatedPrices, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	// 使用参数化查询防止 SQL 注入
	var countResult struct {
		Total int `bun:"total"`
	}
	var prices []*model.ModelPrice

	if search != "" {
		// 带搜索条件的查询（使用参数化查询）
		searchPattern := "%" + search + "%"

		countQuery := `
			WITH latest_prices AS (
				SELECT
					model_name,
					MAX(created_at) as max_created_at
				FROM model_prices
				WHERE model_name ILIKE ?
				GROUP BY model_name
			),
			latest_records AS (
				SELECT
					mp.id,
					ROW_NUMBER() OVER (PARTITION BY mp.model_name ORDER BY mp.id DESC) as rn
				FROM model_prices mp
				INNER JOIN latest_prices lp
					ON mp.model_name = lp.model_name
					AND mp.created_at = lp.max_created_at
			)
			SELECT COUNT(*) as total
			FROM latest_records
			WHERE rn = 1
		`
		_, err := r.db.NewRaw(countQuery, searchPattern).Exec(ctx, &countResult)
		if err != nil {
			return nil, errors.NewDatabaseError(err)
		}

		dataQuery := `
			WITH latest_prices AS (
				SELECT
					model_name,
					MAX(created_at) as max_created_at
				FROM model_prices
				WHERE model_name ILIKE ?
				GROUP BY model_name
			),
			latest_records AS (
				SELECT
					mp.id,
					mp.model_name,
					mp.price_data,
					mp.created_at,
					mp.updated_at,
					ROW_NUMBER() OVER (PARTITION BY mp.model_name ORDER BY mp.id DESC) as rn
				FROM model_prices mp
				INNER JOIN latest_prices lp
					ON mp.model_name = lp.model_name
					AND mp.created_at = lp.max_created_at
			)
			SELECT
				id,
				model_name,
				price_data,
				created_at,
				updated_at
			FROM latest_records
			WHERE rn = 1
			ORDER BY model_name
			LIMIT ? OFFSET ?
		`
		_, err = r.db.NewRaw(dataQuery, searchPattern, pageSize, offset).Exec(ctx, &prices)
		if err != nil {
			return nil, errors.NewDatabaseError(err)
		}
	} else {
		// 无搜索条件的查询
		countQuery := `
			WITH latest_prices AS (
				SELECT
					model_name,
					MAX(created_at) as max_created_at
				FROM model_prices
				GROUP BY model_name
			),
			latest_records AS (
				SELECT
					mp.id,
					ROW_NUMBER() OVER (PARTITION BY mp.model_name ORDER BY mp.id DESC) as rn
				FROM model_prices mp
				INNER JOIN latest_prices lp
					ON mp.model_name = lp.model_name
					AND mp.created_at = lp.max_created_at
			)
			SELECT COUNT(*) as total
			FROM latest_records
			WHERE rn = 1
		`
		_, err := r.db.NewRaw(countQuery).Exec(ctx, &countResult)
		if err != nil {
			return nil, errors.NewDatabaseError(err)
		}

		dataQuery := `
			WITH latest_prices AS (
				SELECT
					model_name,
					MAX(created_at) as max_created_at
				FROM model_prices
				GROUP BY model_name
			),
			latest_records AS (
				SELECT
					mp.id,
					mp.model_name,
					mp.price_data,
					mp.created_at,
					mp.updated_at,
					ROW_NUMBER() OVER (PARTITION BY mp.model_name ORDER BY mp.id DESC) as rn
				FROM model_prices mp
				INNER JOIN latest_prices lp
					ON mp.model_name = lp.model_name
					AND mp.created_at = lp.max_created_at
			)
			SELECT
				id,
				model_name,
				price_data,
				created_at,
				updated_at
			FROM latest_records
			WHERE rn = 1
			ORDER BY model_name
			LIMIT ? OFFSET ?
		`
		_, err = r.db.NewRaw(dataQuery, pageSize, offset).Exec(ctx, &prices)
		if err != nil {
			return nil, errors.NewDatabaseError(err)
		}
	}

	totalPages := countResult.Total / pageSize
	if countResult.Total%pageSize > 0 {
		totalPages++
	}

	return &PaginatedPrices{
		Data:       prices,
		Total:      countResult.Total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

// HasAnyRecords 检查是否存在任意价格记录
func (r *modelPriceRepository) HasAnyRecords(ctx context.Context) (bool, error) {
	count, err := r.db.NewSelect().
		Model((*model.ModelPrice)(nil)).
		Limit(1).
		Count(ctx)

	if err != nil {
		return false, errors.NewDatabaseError(err)
	}

	return count > 0, nil
}

// GetAllModelNames 获取所有模型名称
func (r *modelPriceRepository) GetAllModelNames(ctx context.Context) ([]string, error) {
	var results []struct {
		ModelName string `bun:"model_name"`
	}

	err := r.db.NewSelect().
		Model((*model.ModelPrice)(nil)).
		ColumnExpr("DISTINCT model_name").
		Order("model_name ASC").
		Scan(ctx, &results)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	names := make([]string, 0, len(results))
	for _, r := range results {
		names = append(names, r.ModelName)
	}

	return names, nil
}

// GetChatModelNames 获取所有聊天模型名称
func (r *modelPriceRepository) GetChatModelNames(ctx context.Context) ([]string, error) {
	// 获取所有最新价格，然后过滤出 mode="chat" 的模型
	prices, err := r.ListAllLatestPrices(ctx)
	if err != nil {
		return nil, err
	}

	names := make([]string, 0)
	for _, price := range prices {
		// 检查 price_data 中的 mode 字段
		if price.GetMode() == "chat" {
			names = append(names, price.ModelName)
		}
	}

	return names, nil
}

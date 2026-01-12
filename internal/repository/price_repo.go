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

// ModelPriceRepository 模型价格数据访问接口
type ModelPriceRepository interface {
	Repository

	// Create 创建模型价格记录
	Create(ctx context.Context, price *model.ModelPrice) (*model.ModelPrice, error)

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
func (r *modelPriceRepository) Create(ctx context.Context, price *model.ModelPrice) (*model.ModelPrice, error) {
	now := time.Now()
	price.CreatedAt = now
	price.UpdatedAt = now

	_, err := r.db.NewInsert().
		Model(price).
		Returning("*").
		Exec(ctx)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return price, nil
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
	// CTE 1: 获取每个模型的最新创建时间
	latestPrices := r.db.NewSelect().
		Model((*model.ModelPrice)(nil)).
		Column("model_name").
		ColumnExpr("MAX(created_at) AS max_created_at").
		Group("model_name")

	// CTE 2: 获取最新记录（处理同一时间多条记录的情况）
	latestRecords := r.db.NewSelect().
		ColumnExpr("mp.id, mp.model_name, mp.price_data, mp.created_at, mp.updated_at").
		ColumnExpr("ROW_NUMBER() OVER (PARTITION BY mp.model_name ORDER BY mp.id DESC) AS rn").
		TableExpr("model_prices AS mp").
		Join("INNER JOIN (?) AS lp ON mp.model_name = lp.model_name AND mp.created_at = lp.max_created_at", latestPrices)

	// 主查询：筛选每个模型的第一条记录
	var prices []*model.ModelPrice
	err := r.db.NewSelect().
		With("latest_prices", latestPrices).
		With("latest_records", latestRecords).
		ColumnExpr("id, model_name, price_data, created_at, updated_at").
		TableExpr("latest_records").
		Where("rn = 1").
		Order("model_name ASC").
		Scan(ctx, &prices)

	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	return prices, nil
}

// ListAllLatestPricesPaginated 分页获取所有模型的最新价格
func (r *modelPriceRepository) ListAllLatestPricesPaginated(ctx context.Context, page, pageSize int, search string) (*PaginatedPrices, error) {
	offset := (page - 1) * pageSize

	// 处理搜索参数
	search = strings.TrimSpace(search)

	// 构建基础查询的公共部分
	buildLatestPricesQuery := func() *bun.SelectQuery {
		q := r.db.NewSelect().
			Model((*model.ModelPrice)(nil)).
			Column("model_name").
			ColumnExpr("MAX(created_at) AS max_created_at").
			Group("model_name")
		if search != "" {
			q = q.Where("model_name ILIKE ?", "%"+search+"%")
		}
		return q
	}

	buildLatestRecordsQuery := func(latestPrices *bun.SelectQuery) *bun.SelectQuery {
		return r.db.NewSelect().
			ColumnExpr("mp.id, mp.model_name, mp.price_data, mp.created_at, mp.updated_at").
			ColumnExpr("ROW_NUMBER() OVER (PARTITION BY mp.model_name ORDER BY mp.id DESC) AS rn").
			TableExpr("model_prices AS mp").
			Join("INNER JOIN (?) AS lp ON mp.model_name = lp.model_name AND mp.created_at = lp.max_created_at", latestPrices)
	}

	// 1. 查询总数
	latestPricesForCount := buildLatestPricesQuery()
	latestRecordsForCount := buildLatestRecordsQuery(latestPricesForCount)

	var countResult struct {
		Total int `bun:"total"`
	}
	err := r.db.NewSelect().
		With("latest_prices", latestPricesForCount).
		With("latest_records", latestRecordsForCount).
		ColumnExpr("COUNT(*) AS total").
		TableExpr("latest_records").
		Where("rn = 1").
		Scan(ctx, &countResult)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
	}

	// 2. 查询数据
	latestPricesForData := buildLatestPricesQuery()
	latestRecordsForData := buildLatestRecordsQuery(latestPricesForData)

	var prices []*model.ModelPrice
	err = r.db.NewSelect().
		With("latest_prices", latestPricesForData).
		With("latest_records", latestRecordsForData).
		ColumnExpr("id, model_name, price_data, created_at, updated_at").
		TableExpr("latest_records").
		Where("rn = 1").
		Order("model_name ASC").
		Limit(pageSize).
		Offset(offset).
		Scan(ctx, &prices)
	if err != nil {
		return nil, errors.NewDatabaseError(err)
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

	// 按字母顺序排序
	sort.Strings(names)

	return names, nil
}

// Package repository 提供数据访问层的接口定义和基础实现
package repository

import (
	"context"
	"time"

	"github.com/uptrace/bun"
)

// Repository 基础 Repository 接口
type Repository interface {
	DB() *bun.DB
}

// BaseRepository 基础 Repository 实现，所有 Repository 的公共基类
type BaseRepository struct {
	db *bun.DB
}

// NewBaseRepository 创建基础 Repository
func NewBaseRepository(db *bun.DB) *BaseRepository {
	return &BaseRepository{db: db}
}

// DB 获取数据库实例
func (r *BaseRepository) DB() *bun.DB {
	return r.db
}

// Pagination 分页参数
type Pagination struct {
	Page     int // 页码（从 1 开始）
	PageSize int // 每页数量
	Total    int // 总记录数（由查询方法填充）
}

// GetOffset 计算偏移量
func (p *Pagination) GetOffset() int {
	if p.Page < 1 {
		p.Page = 1
	}
	return (p.Page - 1) * p.PageSize
}

// GetLimit 获取限制数量
func (p *Pagination) GetLimit() int {
	if p.PageSize < 1 {
		p.PageSize = 50 // 默认每页 50 条（与 Node 对齐）
	}
	if p.PageSize > 100 {
		p.PageSize = 100 // 最大 100 条
	}
	return p.PageSize
}

// HasMore 是否有更多数据
func (p *Pagination) HasMore() bool {
	return p.Page*p.PageSize < p.Total
}

// TotalPages 总页数
func (p *Pagination) TotalPages() int {
	if p.PageSize <= 0 {
		return 0
	}
	pages := p.Total / p.PageSize
	if p.Total%p.PageSize > 0 {
		pages++
	}
	return pages
}

// ListOptions 列表查询选项
type ListOptions struct {
	Pagination     *Pagination
	OrderBy        string // 排序字段，如 "created_at DESC"
	IncludeDeleted bool   // 是否包含软删除的记录
}

// NewListOptions 创建默认的列表查询选项
func NewListOptions() *ListOptions {
	return &ListOptions{
		Pagination: &Pagination{
			Page:     1,
			PageSize: 50, // 与 Node 对齐
		},
		OrderBy:        "created_at DESC",
		IncludeDeleted: false,
	}
}

// WithPagination 设置分页参数
func (o *ListOptions) WithPagination(page, pageSize int) *ListOptions {
	o.Pagination = &Pagination{
		Page:     page,
		PageSize: pageSize,
	}
	return o
}

// WithOrderBy 设置排序
func (o *ListOptions) WithOrderBy(orderBy string) *ListOptions {
	o.OrderBy = orderBy
	return o
}

// WithIncludeDeleted 设置是否包含软删除记录
func (o *ListOptions) WithIncludeDeleted(include bool) *ListOptions {
	o.IncludeDeleted = include
	return o
}

// TxFunc 事务函数类型
type TxFunc func(ctx context.Context, tx bun.Tx) error

// RunInTransaction 在事务中执行操作
func RunInTransaction(ctx context.Context, db *bun.DB, fn TxFunc) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}

	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback()
			panic(p)
		}
	}()

	if err := fn(ctx, tx); err != nil {
		_ = tx.Rollback()
		return err
	}

	return tx.Commit()
}

// DefaultTimezone 默认时区
const DefaultTimezone = "Asia/Shanghai"

// ValidateTimezone 校验并返回有效的时区字符串
// 如果传入空字符串或无效时区，返回默认时区
func ValidateTimezone(tz string) string {
	if tz == "" {
		return DefaultTimezone
	}
	// 验证时区是否有效
	if _, err := time.LoadLocation(tz); err != nil {
		return DefaultTimezone
	}
	return tz
}

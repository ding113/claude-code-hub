package errors

import (
	"fmt"
	"net/http"
)

// ErrorType 错误类型
type ErrorType string

const (
	ErrorTypeInvalidRequest     ErrorType = "invalid_request"
	ErrorTypeAuthentication     ErrorType = "authentication_error"
	ErrorTypePermissionDenied   ErrorType = "permission_denied"
	ErrorTypeRateLimitExceeded  ErrorType = "rate_limit_exceeded"
	ErrorTypeProviderError      ErrorType = "provider_error"
	ErrorTypeCircuitBreakerOpen ErrorType = "circuit_breaker_open"
	ErrorTypeInternal           ErrorType = "internal_error"
	ErrorTypeNotFound           ErrorType = "not_found"
)

// ErrorCode 错误码
type ErrorCode string

const (
	// 认证错误
	CodeInvalidAPIKey  ErrorCode = "invalid_api_key"
	CodeExpiredAPIKey  ErrorCode = "expired_api_key"
	CodeDisabledAPIKey ErrorCode = "disabled_api_key"
	CodeDisabledUser   ErrorCode = "disabled_user"

	// 权限错误
	CodeModelNotAllowed  ErrorCode = "model_not_allowed"
	CodeClientNotAllowed ErrorCode = "client_not_allowed"

	// 限流错误
	CodeRPMLimitExceeded     ErrorCode = "rpm_limit_exceeded"
	CodeDailyLimitExceeded   ErrorCode = "daily_limit_exceeded"
	CodeWeeklyLimitExceeded  ErrorCode = "weekly_limit_exceeded"
	CodeMonthlyLimitExceeded ErrorCode = "monthly_limit_exceeded"
	CodeTotalLimitExceeded   ErrorCode = "total_limit_exceeded"

	// 供应商错误
	CodeNoProviderAvailable ErrorCode = "no_provider_available"
	CodeProviderTimeout     ErrorCode = "provider_timeout"
	CodeProviderError       ErrorCode = "provider_error"

	// 熔断错误
	CodeCircuitOpen ErrorCode = "circuit_open"

	// 内部错误
	CodeInternalError ErrorCode = "internal_error"
	CodeDatabaseError ErrorCode = "database_error"
	CodeRedisError    ErrorCode = "redis_error"

	// 请求错误
	CodeInvalidRequest ErrorCode = "invalid_request"
	CodeNotFound       ErrorCode = "not_found"
)

// AppError 应用错误
type AppError struct {
	Type       ErrorType              `json:"type"`
	Message    string                 `json:"message"`
	Code       ErrorCode              `json:"code"`
	Details    map[string]interface{} `json:"details,omitempty"`
	HTTPStatus int                    `json:"-"`
	Err        error                  `json:"-"`
}

// Error 实现 error 接口
func (e *AppError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %s (%v)", e.Type, e.Message, e.Err)
	}
	return fmt.Sprintf("%s: %s", e.Type, e.Message)
}

// Unwrap 实现 errors.Unwrap
func (e *AppError) Unwrap() error {
	return e.Err
}

// WithDetails 添加详情
func (e *AppError) WithDetails(details map[string]interface{}) *AppError {
	e.Details = details
	return e
}

// WithError 包装原始错误
func (e *AppError) WithError(err error) *AppError {
	e.Err = err
	return e
}

// ErrorResponse API 错误响应格式
type ErrorResponse struct {
	Error ErrorResponseBody `json:"error"`
}

// ErrorResponseBody 错误响应体
type ErrorResponseBody struct {
	Type    ErrorType              `json:"type"`
	Message string                 `json:"message"`
	Code    ErrorCode              `json:"code"`
	Details map[string]interface{} `json:"details,omitempty"`
}

// ToResponse 转换为 API 响应格式
func (e *AppError) ToResponse() ErrorResponse {
	return ErrorResponse{
		Error: ErrorResponseBody{
			Type:    e.Type,
			Message: e.Message,
			Code:    e.Code,
			Details: e.Details,
		},
	}
}

// 预定义错误构造函数

// NewInvalidRequest 创建无效请求错误
func NewInvalidRequest(message string) *AppError {
	return &AppError{
		Type:       ErrorTypeInvalidRequest,
		Message:    message,
		Code:       CodeInvalidRequest,
		HTTPStatus: http.StatusBadRequest,
	}
}

// NewAuthenticationError 创建认证错误
func NewAuthenticationError(message string, code ErrorCode) *AppError {
	return &AppError{
		Type:       ErrorTypeAuthentication,
		Message:    message,
		Code:       code,
		HTTPStatus: http.StatusUnauthorized,
	}
}

// NewPermissionDenied 创建权限拒绝错误
func NewPermissionDenied(message string, code ErrorCode) *AppError {
	return &AppError{
		Type:       ErrorTypePermissionDenied,
		Message:    message,
		Code:       code,
		HTTPStatus: http.StatusForbidden,
	}
}

// NewRateLimitExceeded 创建限流错误
func NewRateLimitExceeded(message string, code ErrorCode) *AppError {
	return &AppError{
		Type:       ErrorTypeRateLimitExceeded,
		Message:    message,
		Code:       code,
		HTTPStatus: http.StatusTooManyRequests,
	}
}

// NewProviderError 创建供应商错误
func NewProviderError(message string, code ErrorCode) *AppError {
	return &AppError{
		Type:       ErrorTypeProviderError,
		Message:    message,
		Code:       code,
		HTTPStatus: http.StatusBadGateway,
	}
}

// NewCircuitBreakerOpen 创建熔断器开启错误
func NewCircuitBreakerOpen(providerName string) *AppError {
	return &AppError{
		Type:       ErrorTypeCircuitBreakerOpen,
		Message:    fmt.Sprintf("Circuit breaker is open for provider: %s", providerName),
		Code:       CodeCircuitOpen,
		HTTPStatus: http.StatusServiceUnavailable,
	}
}

// NewInternalError 创建内部错误
func NewInternalError(message string) *AppError {
	return &AppError{
		Type:       ErrorTypeInternal,
		Message:    message,
		Code:       CodeInternalError,
		HTTPStatus: http.StatusInternalServerError,
	}
}

// NewNotFoundError 创建资源不存在错误
func NewNotFoundError(resource string) *AppError {
	return &AppError{
		Type:       ErrorTypeNotFound,
		Message:    fmt.Sprintf("%s not found", resource),
		Code:       CodeNotFound,
		HTTPStatus: http.StatusNotFound,
	}
}

// NewDatabaseError 创建数据库错误
func NewDatabaseError(err error) *AppError {
	return &AppError{
		Type:       ErrorTypeInternal,
		Message:    "Database error",
		Code:       CodeDatabaseError,
		HTTPStatus: http.StatusInternalServerError,
		Err:        err,
	}
}

// NewRedisError 创建 Redis 错误
func NewRedisError(err error) *AppError {
	return &AppError{
		Type:       ErrorTypeInternal,
		Message:    "Redis error",
		Code:       CodeRedisError,
		HTTPStatus: http.StatusInternalServerError,
		Err:        err,
	}
}

// Is 检查错误类型
func Is(err error, target ErrorType) bool {
	if appErr, ok := err.(*AppError); ok {
		return appErr.Type == target
	}
	return false
}

// IsCode 检查错误码
func IsCode(err error, code ErrorCode) bool {
	if appErr, ok := err.(*AppError); ok {
		return appErr.Code == code
	}
	return false
}

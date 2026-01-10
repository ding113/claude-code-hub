package errors

import (
	"fmt"
	"net/http"
	"strings"
)

// ErrorType 错误类型
type ErrorType string

const (
	ErrorTypeInvalidRequest     ErrorType = "invalid_request"
	ErrorTypeAuthentication     ErrorType = "authentication_error"
	ErrorTypePermissionDenied   ErrorType = "permission_denied"
	ErrorTypeRateLimitError     ErrorType = "rate_limit_error" // 与 Node.js 版本一致
	ErrorTypeProviderError      ErrorType = "provider_error"
	ErrorTypeCircuitBreakerOpen ErrorType = "circuit_breaker_open"
	ErrorTypeInternal           ErrorType = "internal_error"
	ErrorTypeNotFound           ErrorType = "not_found"
)

// ErrorCategory 错误分类 - 用于区分错误处理策略
type ErrorCategory int

const (
	// CategoryProviderError 供应商问题（所有 4xx/5xx HTTP 错误）→ 计入熔断器 + 直接切换
	CategoryProviderError ErrorCategory = iota
	// CategorySystemError 系统/网络问题（fetch 网络异常）→ 不计入熔断器 + 先重试1次
	CategorySystemError
	// CategoryClientAbort 客户端主动中断 → 不计入熔断器 + 不重试 + 直接返回
	CategoryClientAbort
	// CategoryNonRetryableClientError 客户端输入错误 → 不计入熔断器 + 不重试 + 直接返回
	CategoryNonRetryableClientError
	// CategoryResourceNotFound 上游 404 错误 → 不计入熔断器 + 直接切换供应商
	CategoryResourceNotFound
)

// ErrorCode 错误码
type ErrorCode string

const (
	// 认证错误
	CodeInvalidAPIKey      ErrorCode = "invalid_api_key"
	CodeExpiredAPIKey      ErrorCode = "expired_api_key"
	CodeDisabledAPIKey     ErrorCode = "disabled_api_key"
	CodeDisabledUser       ErrorCode = "disabled_user"
	CodeUnauthorized       ErrorCode = "unauthorized"
	CodeInvalidToken       ErrorCode = "invalid_token"
	CodeTokenRequired      ErrorCode = "token_required"
	CodeInvalidCredentials ErrorCode = "invalid_credentials"
	CodeSessionExpired     ErrorCode = "session_expired"

	// 权限错误
	CodeModelNotAllowed  ErrorCode = "model_not_allowed"
	CodeClientNotAllowed ErrorCode = "client_not_allowed"
	CodePermissionDenied ErrorCode = "permission_denied"

	// 限流错误
	CodeRateLimitExceeded          ErrorCode = "rate_limit_exceeded"
	CodeRPMLimitExceeded           ErrorCode = "rpm_limit_exceeded"
	Code5HLimitExceeded            ErrorCode = "5h_limit_exceeded"
	CodeDailyLimitExceeded         ErrorCode = "daily_limit_exceeded"
	CodeWeeklyLimitExceeded        ErrorCode = "weekly_limit_exceeded"
	CodeMonthlyLimitExceeded       ErrorCode = "monthly_limit_exceeded"
	CodeTotalLimitExceeded         ErrorCode = "total_limit_exceeded"
	CodeConcurrentSessionsExceeded ErrorCode = "concurrent_sessions_exceeded"

	// 供应商错误
	CodeNoProviderAvailable ErrorCode = "no_provider_available"
	CodeProviderTimeout     ErrorCode = "provider_timeout"
	CodeProviderError       ErrorCode = "provider_error"
	CodeEmptyResponse       ErrorCode = "empty_response"

	// 熔断错误
	CodeCircuitOpen ErrorCode = "circuit_open"

	// 内部错误
	CodeInternalError ErrorCode = "internal_error"
	CodeDatabaseError ErrorCode = "database_error"
	CodeRedisError    ErrorCode = "redis_error"

	// 请求错误
	CodeInvalidRequest ErrorCode = "invalid_request"
	CodeNotFound       ErrorCode = "not_found"

	// 验证错误
	CodeRequiredField    ErrorCode = "required_field"
	CodeUserNameRequired ErrorCode = "user_name_required"
	CodeAPIKeyRequired   ErrorCode = "api_key_required"
	CodeProviderName     ErrorCode = "provider_name_required"
	CodeProviderURL      ErrorCode = "provider_url_required"
	CodeMinLength        ErrorCode = "min_length"
	CodeMaxLength        ErrorCode = "max_length"
	CodeMinValue         ErrorCode = "min_value"
	CodeMaxValue         ErrorCode = "max_value"
	CodeMustBeInteger    ErrorCode = "must_be_integer"
	CodeMustBePositive   ErrorCode = "must_be_positive"
	CodeInvalidEmail     ErrorCode = "invalid_email"
	CodeInvalidURL       ErrorCode = "invalid_url"
	CodeInvalidType      ErrorCode = "invalid_type"
	CodeInvalidFormat    ErrorCode = "invalid_format"
	CodeDuplicateName    ErrorCode = "duplicate_name"
	CodeInvalidRange     ErrorCode = "invalid_range"
	CodeEmptyUpdate      ErrorCode = "empty_update"

	// 网络错误
	CodeConnectionFailed ErrorCode = "connection_failed"
	CodeTimeout          ErrorCode = "timeout"
	CodeNetworkError     ErrorCode = "network_error"

	// 业务错误
	CodeQuotaExceeded ErrorCode = "quota_exceeded"
	CodeResourceBusy  ErrorCode = "resource_busy"
	CodeInvalidState  ErrorCode = "invalid_state"
	CodeConflict      ErrorCode = "conflict"

	// 操作错误
	CodeOperationFailed ErrorCode = "operation_failed"
	CodeCreateFailed    ErrorCode = "create_failed"
	CodeUpdateFailed    ErrorCode = "update_failed"
	CodeDeleteFailed    ErrorCode = "delete_failed"
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
		Type:       ErrorTypeRateLimitError,
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

// ============================================================================
// 代理模块专用错误类型 - 与 Node.js 版本 src/app/v1/_lib/proxy/errors.ts 对齐
// ============================================================================

// LimitType 限流类型
type LimitType string

const (
	LimitTypeRPM                LimitType = "rpm"
	LimitTypeUSD5H              LimitType = "usd_5h"
	LimitTypeUSDWeekly          LimitType = "usd_weekly"
	LimitTypeUSDMonthly         LimitType = "usd_monthly"
	LimitTypeUSDTotal           LimitType = "usd_total"
	LimitTypeConcurrentSessions LimitType = "concurrent_sessions"
	LimitTypeDailyQuota         LimitType = "daily_quota"
)

// RateLimitError 限流错误 - 携带详细的限流上下文信息
// 与 Node.js 版本的 RateLimitError 类对齐
type RateLimitError struct {
	Type         string    `json:"type"`          // 固定为 "rate_limit_error"
	Message      string    `json:"message"`       // 人类可读的错误消息
	LimitType    LimitType `json:"limit_type"`    // 限流类型
	CurrentUsage float64   `json:"current_usage"` // 当前使用量
	LimitValue   float64   `json:"limit_value"`   // 限制值
	ResetTime    string    `json:"reset_time"`    // 重置时间（ISO 8601 格式）
	ProviderID   *int      `json:"provider_id"`   // 供应商 ID（可选）
}

// Error 实现 error 接口
func (e *RateLimitError) Error() string {
	return e.Message
}

// NewRateLimitError 创建限流错误
func NewRateLimitError(
	message string,
	limitType LimitType,
	currentUsage float64,
	limitValue float64,
	resetTime string,
	providerID *int,
) *RateLimitError {
	return &RateLimitError{
		Type:         "rate_limit_error",
		Message:      message,
		LimitType:    limitType,
		CurrentUsage: currentUsage,
		LimitValue:   limitValue,
		ResetTime:    resetTime,
		ProviderID:   providerID,
	}
}

// ToJSON 获取适合记录到数据库的 JSON 元数据
func (e *RateLimitError) ToJSON() map[string]interface{} {
	return map[string]interface{}{
		"type":          e.Type,
		"limit_type":    e.LimitType,
		"current_usage": e.CurrentUsage,
		"limit_value":   e.LimitValue,
		"reset_time":    e.ResetTime,
		"provider_id":   e.ProviderID,
		"message":       e.Message,
	}
}

// IsRateLimitError 类型守卫：检查是否为 RateLimitError
func IsRateLimitError(err error) bool {
	_, ok := err.(*RateLimitError)
	return ok
}

// AsRateLimitError 类型转换：将 error 转换为 RateLimitError
func AsRateLimitError(err error) (*RateLimitError, bool) {
	e, ok := err.(*RateLimitError)
	return e, ok
}

// UpstreamError 上游错误信息
type UpstreamError struct {
	Body         string      `json:"body"`                    // 原始响应体（智能截断）
	Parsed       interface{} `json:"parsed,omitempty"`        // 解析后的 JSON（如果有）
	ProviderID   *int        `json:"provider_id,omitempty"`   // 供应商 ID
	ProviderName string      `json:"provider_name,omitempty"` // 供应商名称
	RequestID    string      `json:"request_id,omitempty"`    // 上游请求 ID
}

// ProxyError 代理错误 - 携带上游完整错误信息
// 与 Node.js 版本的 ProxyError 类对齐
type ProxyError struct {
	Message       string         `json:"message"`
	StatusCode    int            `json:"status_code"`
	UpstreamError *UpstreamError `json:"upstream_error,omitempty"`
}

// Error 实现 error 接口
func (e *ProxyError) Error() string {
	return e.Message
}

// NewProxyError 创建代理错误
func NewProxyError(message string, statusCode int, upstreamError *UpstreamError) *ProxyError {
	return &ProxyError{
		Message:       message,
		StatusCode:    statusCode,
		UpstreamError: upstreamError,
	}
}

// GetDetailedErrorMessage 获取适合记录到数据库的详细错误信息
// 格式：Provider {name} returned {status}: {message} | Upstream: {body}
func (e *ProxyError) GetDetailedErrorMessage() string {
	if e.UpstreamError != nil && e.UpstreamError.ProviderName != "" {
		msg := fmt.Sprintf("Provider %s returned %d: %s",
			e.UpstreamError.ProviderName, e.StatusCode, e.Message)
		if e.UpstreamError.Body != "" {
			msg += " | Upstream: " + e.UpstreamError.Body
		}
		return msg
	}
	return e.Message
}

// GetClientSafeMessage 获取适合返回给客户端的安全错误信息
// 不包含供应商名称等敏感信息
func (e *ProxyError) GetClientSafeMessage() string {
	return e.Message
}

// IsProxyError 类型守卫：检查是否为 ProxyError
func IsProxyError(err error) bool {
	_, ok := err.(*ProxyError)
	return ok
}

// AsProxyError 类型转换：将 error 转换为 ProxyError
func AsProxyError(err error) (*ProxyError, bool) {
	e, ok := err.(*ProxyError)
	return e, ok
}

// EmptyResponseReason 空响应原因
type EmptyResponseReason string

const (
	EmptyResponseReasonEmptyBody      EmptyResponseReason = "empty_body"
	EmptyResponseReasonNoOutputTokens EmptyResponseReason = "no_output_tokens"
	EmptyResponseReasonMissingContent EmptyResponseReason = "missing_content"
)

// EmptyResponseError 空响应错误 - 用于检测上游返回空响应或缺少输出 token 的情况
// 与 Node.js 版本的 EmptyResponseError 类对齐
type EmptyResponseError struct {
	ProviderID   int                 `json:"provider_id"`
	ProviderName string              `json:"provider_name"`
	Reason       EmptyResponseReason `json:"reason"`
	message      string
}

// Error 实现 error 接口
func (e *EmptyResponseError) Error() string {
	return e.message
}

// NewEmptyResponseError 创建空响应错误
func NewEmptyResponseError(providerID int, providerName string, reason EmptyResponseReason) *EmptyResponseError {
	reasonMessages := map[EmptyResponseReason]string{
		EmptyResponseReasonEmptyBody:      "Response body is empty",
		EmptyResponseReasonNoOutputTokens: "Response has no output tokens",
		EmptyResponseReasonMissingContent: "Response is missing content field",
	}
	message := fmt.Sprintf("Empty response from provider %s: %s", providerName, reasonMessages[reason])
	return &EmptyResponseError{
		ProviderID:   providerID,
		ProviderName: providerName,
		Reason:       reason,
		message:      message,
	}
}

// ToJSON 获取适合记录的 JSON 元数据
func (e *EmptyResponseError) ToJSON() map[string]interface{} {
	return map[string]interface{}{
		"type":          "empty_response_error",
		"provider_id":   e.ProviderID,
		"provider_name": e.ProviderName,
		"reason":        e.Reason,
		"message":       e.message,
	}
}

// GetClientSafeMessage 获取适合返回给客户端的安全错误信息
// 不包含供应商名称等敏感信息
func (e *EmptyResponseError) GetClientSafeMessage() string {
	reasonMessages := map[EmptyResponseReason]string{
		EmptyResponseReasonEmptyBody:      "Response body is empty",
		EmptyResponseReasonNoOutputTokens: "Response has no output tokens",
		EmptyResponseReasonMissingContent: "Response is missing content field",
	}
	return fmt.Sprintf("Empty response: %s", reasonMessages[e.Reason])
}

// IsEmptyResponseError 类型守卫：检查是否为 EmptyResponseError
func IsEmptyResponseError(err error) bool {
	_, ok := err.(*EmptyResponseError)
	return ok
}

// AsEmptyResponseError 类型转换：将 error 转换为 EmptyResponseError
func AsEmptyResponseError(err error) (*EmptyResponseError, bool) {
	e, ok := err.(*EmptyResponseError)
	return e, ok
}

// ============================================================================
// 错误分类函数 - 与 Node.js 版本 categorizeErrorAsync 对齐
// ============================================================================

// ErrorRuleChecker 错误规则检测器接口
// 用于检测错误是否匹配不可重试的客户端输入错误规则
type ErrorRuleChecker interface {
	// IsNonRetryableClientError 检查错误是否为不可重试的客户端输入错误
	// 返回 true 表示该错误匹配了错误规则，应该直接返回给客户端而不重试
	IsNonRetryableClientError(err error) bool
}

// CategorizeError 判断错误类型（简化版本，不检测客户端输入错误规则）
// 分类规则（优先级从高到低）：
// 1. 客户端主动中断 → CategoryClientAbort
// 2. ProxyError 404 → CategoryResourceNotFound
// 3. ProxyError 其他 → CategoryProviderError
// 4. EmptyResponseError → CategoryProviderError
// 5. 其他 → CategorySystemError
//
// 注意：如果需要检测不可重试的客户端输入错误，请使用 CategorizeErrorWithRuleChecker
func CategorizeError(err error) ErrorCategory {
	return CategorizeErrorWithRuleChecker(err, nil)
}

// CategorizeErrorWithRuleChecker 判断错误类型（完整版本，支持错误规则检测）
// 分类规则（优先级从高到低）：
// 1. 客户端主动中断 → CategoryClientAbort
// 2. 不可重试的客户端输入错误（通过 ruleChecker 检测）→ CategoryNonRetryableClientError
// 3. ProxyError 404 → CategoryResourceNotFound
// 4. ProxyError 其他 → CategoryProviderError
// 5. EmptyResponseError → CategoryProviderError
// 6. 其他 → CategorySystemError
func CategorizeErrorWithRuleChecker(err error, ruleChecker ErrorRuleChecker) ErrorCategory {
	// 优先级 1: 客户端中断检测
	if IsClientAbortError(err) {
		return CategoryClientAbort
	}

	// 优先级 2: 不可重试的客户端输入错误（需要配合错误规则检测器）
	if ruleChecker != nil && ruleChecker.IsNonRetryableClientError(err) {
		return CategoryNonRetryableClientError
	}

	// 优先级 3: ProxyError
	if proxyErr, ok := AsProxyError(err); ok {
		if proxyErr.StatusCode == http.StatusNotFound {
			return CategoryResourceNotFound
		}
		return CategoryProviderError
	}

	// 优先级 4: EmptyResponseError
	if IsEmptyResponseError(err) {
		return CategoryProviderError
	}

	// 优先级 5: 其他都是系统错误
	return CategorySystemError
}

// IsClientAbortError 检测是否为客户端中断错误
// 采用白名单模式，精确检测客户端主动中断的错误
func IsClientAbortError(err error) bool {
	if err == nil {
		return false
	}

	// 检查 ProxyError 状态码 499（Client Closed Request）
	if proxyErr, ok := AsProxyError(err); ok {
		if proxyErr.StatusCode == 499 {
			return true
		}
	}

	// 检查错误消息中的中断标识
	errMsg := err.Error()
	abortMessages := []string{
		"context canceled",
		"context deadline exceeded",
		"client disconnected",
		"connection reset by peer",
	}

	for _, msg := range abortMessages {
		if contains(errMsg, msg) {
			return true
		}
	}

	return false
}

// contains 检查字符串是否包含子串（不区分大小写）
func contains(s, substr string) bool {
	return strings.Contains(strings.ToLower(s), strings.ToLower(substr))
}

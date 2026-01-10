package httpclient

import (
	"time"

	"github.com/go-resty/resty/v2"
)

// Client HTTP 客户端包装器
type Client struct {
	*resty.Client
}

// Config 客户端配置
type Config struct {
	Timeout       time.Duration
	RetryCount    int
	RetryWaitTime time.Duration
}

// DefaultConfig 默认配置
func DefaultConfig() Config {
	return Config{
		Timeout:       30 * time.Second,
		RetryCount:    0,
		RetryWaitTime: 100 * time.Millisecond,
	}
}

// New 创建新的 HTTP 客户端
func New(cfg Config) *Client {
	client := resty.New().
		SetTimeout(cfg.Timeout).
		SetRetryCount(cfg.RetryCount).
		SetRetryWaitTime(cfg.RetryWaitTime)

	return &Client{Client: client}
}

// NewDefault 创建默认配置的客户端
func NewDefault() *Client {
	return New(DefaultConfig())
}

// WithBaseURL 设置基础 URL
func (c *Client) WithBaseURL(url string) *Client {
	c.SetBaseURL(url)
	return c
}

// WithHeader 设置请求头
func (c *Client) WithHeader(key, value string) *Client {
	c.SetHeader(key, value)
	return c
}

// WithHeaders 设置多个请求头
func (c *Client) WithHeaders(headers map[string]string) *Client {
	c.SetHeaders(headers)
	return c
}

// WithAuthToken 设置认证 Token
func (c *Client) WithAuthToken(token string) *Client {
	c.SetAuthToken(token)
	return c
}

// WithBearerAuth 设置 Bearer 认证
func (c *Client) WithBearerAuth(token string) *Client {
	c.SetAuthScheme("Bearer")
	c.SetAuthToken(token)
	return c
}

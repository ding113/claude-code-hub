package utils

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"github.com/google/uuid"
)

// GenerateUUID 生成 UUID
func GenerateUUID() string {
	return uuid.New().String()
}

// GenerateRequestID 生成请求 ID
func GenerateRequestID() string {
	return "req_" + strings.ReplaceAll(uuid.New().String(), "-", "")[:24]
}

// GenerateSessionID 生成会话 ID
func GenerateSessionID() string {
	return "sess_" + strings.ReplaceAll(uuid.New().String(), "-", "")[:24]
}

// GenerateAPIKey 生成 API Key
func GenerateAPIKey(prefix string) string {
	bytes := make([]byte, 32)
	_, _ = rand.Read(bytes)
	key := hex.EncodeToString(bytes)
	return prefix + "_" + key
}

// HashAPIKey 对 API Key 进行哈希
func HashAPIKey(key string) string {
	hash := sha256.Sum256([]byte(key))
	return hex.EncodeToString(hash[:])
}

// GetAPIKeyPrefix 获取 API Key 前缀
func GetAPIKeyPrefix(key string) string {
	parts := strings.SplitN(key, "_", 2)
	if len(parts) < 2 {
		return ""
	}
	// 返回前缀 + 前8个字符
	if len(parts[1]) > 8 {
		return parts[0] + "_" + parts[1][:8]
	}
	return key
}

// MaskAPIKey 遮蔽 API Key
func MaskAPIKey(key string) string {
	if len(key) <= 12 {
		return "****"
	}
	return key[:8] + "..." + key[len(key)-4:]
}

package validator

import (
	"reflect"
	"strings"
	"sync"

	"github.com/gin-gonic/gin/binding"
	"github.com/go-playground/validator/v10"
)

var (
	once     sync.Once
	validate *validator.Validate
)

// Get 获取验证器实例
func Get() *validator.Validate {
	once.Do(func() {
		validate = validator.New()

		// 使用 JSON tag 作为字段名
		validate.RegisterTagNameFunc(func(fld reflect.StructField) string {
			name := strings.SplitN(fld.Tag.Get("json"), ",", 2)[0]
			if name == "-" {
				return ""
			}
			return name
		})

		// 注册自定义验证器
		registerCustomValidators(validate)
	})
	return validate
}

// Init 初始化验证器并绑定到 Gin
func Init() {
	if v, ok := binding.Validator.Engine().(*validator.Validate); ok {
		// 使用 JSON tag 作为字段名
		v.RegisterTagNameFunc(func(fld reflect.StructField) string {
			name := strings.SplitN(fld.Tag.Get("json"), ",", 2)[0]
			if name == "-" {
				return ""
			}
			return name
		})

		// 注册自定义验证器
		registerCustomValidators(v)
	}
}

// registerCustomValidators 注册自定义验证器
func registerCustomValidators(v *validator.Validate) {
	// 可以在这里注册自定义验证规则
	// 例如: v.RegisterValidation("custom_rule", customRuleFunc)
}

// Validate 验证结构体
func Validate(s interface{}) error {
	return Get().Struct(s)
}

// ValidationErrors 格式化验证错误
func ValidationErrors(err error) map[string]string {
	errors := make(map[string]string)

	if validationErrors, ok := err.(validator.ValidationErrors); ok {
		for _, e := range validationErrors {
			field := e.Field()
			switch e.Tag() {
			case "required":
				errors[field] = field + " is required"
			case "email":
				errors[field] = field + " must be a valid email"
			case "min":
				errors[field] = field + " must be at least " + e.Param()
			case "max":
				errors[field] = field + " must be at most " + e.Param()
			case "oneof":
				errors[field] = field + " must be one of: " + e.Param()
			default:
				errors[field] = field + " is invalid"
			}
		}
	}

	return errors
}

// AUTO-GENERATED — DO NOT EDIT. Run `bun run openapi:generate` to refresh.

export interface paths {
    "/api/v1/webhook-targets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 列出所有 webhook 推送目标
         * @description 返回全部 webhook 推送目标；敏感字段已脱敏。需要管理员权限。
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 推送目标列表 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @description Webhook 推送目标列表 */
                            items: {
                                /**
                                 * @description 数据库主键
                                 * @example 1
                                 */
                                id: number;
                                /**
                                 * @description 目标名称
                                 * @example 运维群-企业微信
                                 */
                                name: string;
                                /**
                                 * @description Webhook 推送目标提供方类型
                                 * @example wechat
                                 * @enum {string}
                                 */
                                providerType: "wechat" | "feishu" | "dingtalk" | "telegram" | "custom";
                                /**
                                 * @description 已脱敏的敏感字段：未配置时为 null；已配置时固定为字符串 "[REDACTED]"
                                 * @example [REDACTED]
                                 */
                                webhookUrl: "[REDACTED]" | null;
                                /**
                                 * @description 已脱敏的敏感字段：未配置时为 null；已配置时固定为字符串 "[REDACTED]"
                                 * @example [REDACTED]
                                 */
                                telegramBotToken: "[REDACTED]" | null;
                                /**
                                 * @description 已脱敏的敏感字段：未配置时为 null；已配置时固定为字符串 "[REDACTED]"
                                 * @example [REDACTED]
                                 */
                                telegramChatId: "[REDACTED]" | null;
                                /**
                                 * @description 已脱敏的敏感字段：未配置时为 null；已配置时固定为字符串 "[REDACTED]"
                                 * @example [REDACTED]
                                 */
                                dingtalkSecret: "[REDACTED]" | null;
                                /**
                                 * @description 自定义模板（不属于敏感凭证，原样回传）
                                 * @example {
                                 *       "title": "{{event}}"
                                 *     }
                                 */
                                customTemplate: {
                                    [key: string]: unknown;
                                } | null;
                                /**
                                 * @description 自定义 HTTP 头
                                 * @example {
                                 *       "X-Source": "claude-code-hub"
                                 *     }
                                 */
                                customHeaders: {
                                    [key: string]: string;
                                } | null;
                                /**
                                 * @description 出站代理地址；如未配置则为 null
                                 * @example null
                                 */
                                proxyUrl: string | null;
                                /**
                                 * @description 代理失败时是否回退到直连
                                 * @example false
                                 */
                                proxyFallbackToDirect: boolean;
                                /**
                                 * @description 是否启用
                                 * @example true
                                 */
                                isEnabled: boolean;
                                /**
                                 * @description 上次测试是否成功；未测试过为 null
                                 * @example true
                                 */
                                lastTestSuccess: boolean | null;
                                /**
                                 * @description 上次测试的错误描述（失败时存在）
                                 * @example null
                                 */
                                lastTestError: string | null;
                                /**
                                 * Format: date-time
                                 * @description 上次测试时间（ISO 8601）
                                 * @example 2025-04-28T13:45:00.000Z
                                 */
                                lastTestAt: string | null;
                                /**
                                 * @description 上次测试的延迟（毫秒）
                                 * @example 234
                                 */
                                lastTestLatencyMs: number | null;
                                /**
                                 * Format: date-time
                                 * @description 创建时间（ISO 8601）
                                 * @example 2025-04-28T13:45:00.000Z
                                 */
                                createdAt: string | null;
                                /**
                                 * Format: date-time
                                 * @description 更新时间（ISO 8601）
                                 * @example 2025-04-28T13:45:00.000Z
                                 */
                                updatedAt: string | null;
                            }[];
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        /**
         * 创建 webhook 推送目标
         * @description 创建一个新的 webhook 推送目标。需要管理员权限，cookie 鉴权时必须携带 X-CCH-CSRF。响应中敏感字段已脱敏。
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description 目标名称（用户可见的显示名）
                         * @example 运维群-企业微信
                         */
                        name: string;
                        /**
                         * @description Webhook 推送目标提供方类型
                         * @example wechat
                         * @enum {string}
                         */
                        providerType: "wechat" | "feishu" | "dingtalk" | "telegram" | "custom";
                        /**
                         * Format: uri
                         * @description Webhook URL（telegram 类型不使用此字段）
                         * @example https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...
                         */
                        webhookUrl?: string | null;
                        /**
                         * @description Telegram Bot Token（仅 telegram 类型）
                         * @example 123456:AAEXXXXXX
                         */
                        telegramBotToken?: string | null;
                        /**
                         * @description Telegram Chat ID（仅 telegram 类型）
                         * @example -1001234567890
                         */
                        telegramChatId?: string | null;
                        /**
                         * @description 钉钉机器人加签密钥（仅 dingtalk 类型）
                         * @example SEC1234567890
                         */
                        dingtalkSecret?: string | null;
                        /**
                         * @description 自定义模板：JSON 对象或可被解析为对象的字符串
                         * @example {
                         *       "title": "{{event}}",
                         *       "body": "{{message}}"
                         *     }
                         */
                        customTemplate?: string | {
                            [key: string]: unknown;
                        } | null;
                        /**
                         * @description 自定义 HTTP 头键值对（仅 custom 类型使用）
                         * @example {
                         *       "X-Source": "claude-code-hub"
                         *     }
                         */
                        customHeaders?: {
                            [key: string]: string;
                        } | null;
                        /**
                         * @description 出站代理地址（http / https / socks5 / socks4）
                         * @example http://proxy.example:1080
                         */
                        proxyUrl?: string | null;
                        /**
                         * @description 代理失败时是否回退到直连
                         * @example false
                         */
                        proxyFallbackToDirect?: boolean;
                        /**
                         * @description 是否启用该目标
                         * @example true
                         */
                        isEnabled?: boolean;
                    };
                };
            };
            responses: {
                /** @description 创建成功；Location 头指向新资源 */
                201: {
                    headers: {
                        /** @description 新资源的相对 URL */
                        Location?: string;
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /**
                             * @description 数据库主键
                             * @example 1
                             */
                            id: number;
                            /**
                             * @description 目标名称
                             * @example 运维群-企业微信
                             */
                            name: string;
                            /**
                             * @description Webhook 推送目标提供方类型
                             * @example wechat
                             * @enum {string}
                             */
                            providerType: "wechat" | "feishu" | "dingtalk" | "telegram" | "custom";
                            /**
                             * @description 已脱敏的敏感字段：未配置时为 null；已配置时固定为字符串 "[REDACTED]"
                             * @example [REDACTED]
                             */
                            webhookUrl: "[REDACTED]" | null;
                            /**
                             * @description 已脱敏的敏感字段：未配置时为 null；已配置时固定为字符串 "[REDACTED]"
                             * @example [REDACTED]
                             */
                            telegramBotToken: "[REDACTED]" | null;
                            /**
                             * @description 已脱敏的敏感字段：未配置时为 null；已配置时固定为字符串 "[REDACTED]"
                             * @example [REDACTED]
                             */
                            telegramChatId: "[REDACTED]" | null;
                            /**
                             * @description 已脱敏的敏感字段：未配置时为 null；已配置时固定为字符串 "[REDACTED]"
                             * @example [REDACTED]
                             */
                            dingtalkSecret: "[REDACTED]" | null;
                            /**
                             * @description 自定义模板（不属于敏感凭证，原样回传）
                             * @example {
                             *       "title": "{{event}}"
                             *     }
                             */
                            customTemplate: {
                                [key: string]: unknown;
                            } | null;
                            /**
                             * @description 自定义 HTTP 头
                             * @example {
                             *       "X-Source": "claude-code-hub"
                             *     }
                             */
                            customHeaders: {
                                [key: string]: string;
                            } | null;
                            /**
                             * @description 出站代理地址；如未配置则为 null
                             * @example null
                             */
                            proxyUrl: string | null;
                            /**
                             * @description 代理失败时是否回退到直连
                             * @example false
                             */
                            proxyFallbackToDirect: boolean;
                            /**
                             * @description 是否启用
                             * @example true
                             */
                            isEnabled: boolean;
                            /**
                             * @description 上次测试是否成功；未测试过为 null
                             * @example true
                             */
                            lastTestSuccess: boolean | null;
                            /**
                             * @description 上次测试的错误描述（失败时存在）
                             * @example null
                             */
                            lastTestError: string | null;
                            /**
                             * Format: date-time
                             * @description 上次测试时间（ISO 8601）
                             * @example 2025-04-28T13:45:00.000Z
                             */
                            lastTestAt: string | null;
                            /**
                             * @description 上次测试的延迟（毫秒）
                             * @example 234
                             */
                            lastTestLatencyMs: number | null;
                            /**
                             * Format: date-time
                             * @description 创建时间（ISO 8601）
                             * @example 2025-04-28T13:45:00.000Z
                             */
                            createdAt: string | null;
                            /**
                             * Format: date-time
                             * @description 更新时间（ISO 8601）
                             * @example 2025-04-28T13:45:00.000Z
                             */
                            updatedAt: string | null;
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/webhook-targets/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询单个 webhook 推送目标
         * @description 通过数字 id 获取单个推送目标；敏感字段已脱敏。
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 推送目标详情 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /**
                             * @description 数据库主键
                             * @example 1
                             */
                            id: number;
                            /**
                             * @description 目标名称
                             * @example 运维群-企业微信
                             */
                            name: string;
                            /**
                             * @description Webhook 推送目标提供方类型
                             * @example wechat
                             * @enum {string}
                             */
                            providerType: "wechat" | "feishu" | "dingtalk" | "telegram" | "custom";
                            /**
                             * @description 已脱敏的敏感字段：未配置时为 null；已配置时固定为字符串 "[REDACTED]"
                             * @example [REDACTED]
                             */
                            webhookUrl: "[REDACTED]" | null;
                            /**
                             * @description 已脱敏的敏感字段：未配置时为 null；已配置时固定为字符串 "[REDACTED]"
                             * @example [REDACTED]
                             */
                            telegramBotToken: "[REDACTED]" | null;
                            /**
                             * @description 已脱敏的敏感字段：未配置时为 null；已配置时固定为字符串 "[REDACTED]"
                             * @example [REDACTED]
                             */
                            telegramChatId: "[REDACTED]" | null;
                            /**
                             * @description 已脱敏的敏感字段：未配置时为 null；已配置时固定为字符串 "[REDACTED]"
                             * @example [REDACTED]
                             */
                            dingtalkSecret: "[REDACTED]" | null;
                            /**
                             * @description 自定义模板（不属于敏感凭证，原样回传）
                             * @example {
                             *       "title": "{{event}}"
                             *     }
                             */
                            customTemplate: {
                                [key: string]: unknown;
                            } | null;
                            /**
                             * @description 自定义 HTTP 头
                             * @example {
                             *       "X-Source": "claude-code-hub"
                             *     }
                             */
                            customHeaders: {
                                [key: string]: string;
                            } | null;
                            /**
                             * @description 出站代理地址；如未配置则为 null
                             * @example null
                             */
                            proxyUrl: string | null;
                            /**
                             * @description 代理失败时是否回退到直连
                             * @example false
                             */
                            proxyFallbackToDirect: boolean;
                            /**
                             * @description 是否启用
                             * @example true
                             */
                            isEnabled: boolean;
                            /**
                             * @description 上次测试是否成功；未测试过为 null
                             * @example true
                             */
                            lastTestSuccess: boolean | null;
                            /**
                             * @description 上次测试的错误描述（失败时存在）
                             * @example null
                             */
                            lastTestError: string | null;
                            /**
                             * Format: date-time
                             * @description 上次测试时间（ISO 8601）
                             * @example 2025-04-28T13:45:00.000Z
                             */
                            lastTestAt: string | null;
                            /**
                             * @description 上次测试的延迟（毫秒）
                             * @example 234
                             */
                            lastTestLatencyMs: number | null;
                            /**
                             * Format: date-time
                             * @description 创建时间（ISO 8601）
                             * @example 2025-04-28T13:45:00.000Z
                             */
                            createdAt: string | null;
                            /**
                             * Format: date-time
                             * @description 更新时间（ISO 8601）
                             * @example 2025-04-28T13:45:00.000Z
                             */
                            updatedAt: string | null;
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        /**
         * 删除 webhook 推送目标
         * @description 删除指定的推送目标；幂等。Cookie 鉴权时必须携带 X-CCH-CSRF。
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 删除成功（无响应体） */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        /**
         * 更新 webhook 推送目标
         * @description 局部更新一个推送目标；未提供的字段保持原值。Cookie 鉴权时必须携带 X-CCH-CSRF。
         */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description 目标名称（用户可见的显示名）
                         * @example 运维群-企业微信
                         */
                        name?: string;
                        /**
                         * @description Webhook 推送目标提供方类型
                         * @example wechat
                         * @enum {string}
                         */
                        providerType?: "wechat" | "feishu" | "dingtalk" | "telegram" | "custom";
                        /**
                         * Format: uri
                         * @description Webhook URL（telegram 类型不使用此字段）
                         * @example https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...
                         */
                        webhookUrl?: string | null;
                        /**
                         * @description Telegram Bot Token（仅 telegram 类型）
                         * @example 123456:AAEXXXXXX
                         */
                        telegramBotToken?: string | null;
                        /**
                         * @description Telegram Chat ID（仅 telegram 类型）
                         * @example -1001234567890
                         */
                        telegramChatId?: string | null;
                        /**
                         * @description 钉钉机器人加签密钥（仅 dingtalk 类型）
                         * @example SEC1234567890
                         */
                        dingtalkSecret?: string | null;
                        /**
                         * @description 自定义模板：JSON 对象或可被解析为对象的字符串
                         * @example {
                         *       "title": "{{event}}",
                         *       "body": "{{message}}"
                         *     }
                         */
                        customTemplate?: string | {
                            [key: string]: unknown;
                        } | null;
                        /**
                         * @description 自定义 HTTP 头键值对（仅 custom 类型使用）
                         * @example {
                         *       "X-Source": "claude-code-hub"
                         *     }
                         */
                        customHeaders?: {
                            [key: string]: string;
                        } | null;
                        /**
                         * @description 出站代理地址（http / https / socks5 / socks4）
                         * @example http://proxy.example:1080
                         */
                        proxyUrl?: string | null;
                        /**
                         * @description 代理失败时是否回退到直连
                         * @example false
                         */
                        proxyFallbackToDirect?: boolean;
                        /**
                         * @description 是否启用该目标
                         * @example true
                         */
                        isEnabled?: boolean;
                    };
                };
            };
            responses: {
                /** @description 更新后的推送目标 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /**
                             * @description 数据库主键
                             * @example 1
                             */
                            id: number;
                            /**
                             * @description 目标名称
                             * @example 运维群-企业微信
                             */
                            name: string;
                            /**
                             * @description Webhook 推送目标提供方类型
                             * @example wechat
                             * @enum {string}
                             */
                            providerType: "wechat" | "feishu" | "dingtalk" | "telegram" | "custom";
                            /**
                             * @description 已脱敏的敏感字段：未配置时为 null；已配置时固定为字符串 "[REDACTED]"
                             * @example [REDACTED]
                             */
                            webhookUrl: "[REDACTED]" | null;
                            /**
                             * @description 已脱敏的敏感字段：未配置时为 null；已配置时固定为字符串 "[REDACTED]"
                             * @example [REDACTED]
                             */
                            telegramBotToken: "[REDACTED]" | null;
                            /**
                             * @description 已脱敏的敏感字段：未配置时为 null；已配置时固定为字符串 "[REDACTED]"
                             * @example [REDACTED]
                             */
                            telegramChatId: "[REDACTED]" | null;
                            /**
                             * @description 已脱敏的敏感字段：未配置时为 null；已配置时固定为字符串 "[REDACTED]"
                             * @example [REDACTED]
                             */
                            dingtalkSecret: "[REDACTED]" | null;
                            /**
                             * @description 自定义模板（不属于敏感凭证，原样回传）
                             * @example {
                             *       "title": "{{event}}"
                             *     }
                             */
                            customTemplate: {
                                [key: string]: unknown;
                            } | null;
                            /**
                             * @description 自定义 HTTP 头
                             * @example {
                             *       "X-Source": "claude-code-hub"
                             *     }
                             */
                            customHeaders: {
                                [key: string]: string;
                            } | null;
                            /**
                             * @description 出站代理地址；如未配置则为 null
                             * @example null
                             */
                            proxyUrl: string | null;
                            /**
                             * @description 代理失败时是否回退到直连
                             * @example false
                             */
                            proxyFallbackToDirect: boolean;
                            /**
                             * @description 是否启用
                             * @example true
                             */
                            isEnabled: boolean;
                            /**
                             * @description 上次测试是否成功；未测试过为 null
                             * @example true
                             */
                            lastTestSuccess: boolean | null;
                            /**
                             * @description 上次测试的错误描述（失败时存在）
                             * @example null
                             */
                            lastTestError: string | null;
                            /**
                             * Format: date-time
                             * @description 上次测试时间（ISO 8601）
                             * @example 2025-04-28T13:45:00.000Z
                             */
                            lastTestAt: string | null;
                            /**
                             * @description 上次测试的延迟（毫秒）
                             * @example 234
                             */
                            lastTestLatencyMs: number | null;
                            /**
                             * Format: date-time
                             * @description 创建时间（ISO 8601）
                             * @example 2025-04-28T13:45:00.000Z
                             */
                            createdAt: string | null;
                            /**
                             * Format: date-time
                             * @description 更新时间（ISO 8601）
                             * @example 2025-04-28T13:45:00.000Z
                             */
                            updatedAt: string | null;
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/webhook-targets/{id}:test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 向 webhook 推送目标发送测试通知
         * @description 向指定的推送目标发送一次测试通知，便于排查配置问题。响应包含本次发送耗时；带 Cache-Control: no-store。Cookie 鉴权时必须携带 X-CCH-CSRF。
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description 通知类别（用于 :test 端点选择测试模板）
                         * @example circuit_breaker
                         * @enum {string}
                         */
                        notificationType: "circuit_breaker" | "daily_leaderboard" | "cost_alert" | "cache_hit_rate_alert";
                    };
                };
            };
            responses: {
                /** @description 测试已发送 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /**
                             * @description 本次测试发送耗时（毫秒）
                             * @example 234
                             */
                            latencyMs: number;
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 列出用户（游标分页）
         * @description 管理员接口；支持 cursor / limit / searchTerm / 状态过滤 / 排序 / 标签过滤。
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 用户列表 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @description 用户列表 */
                            items: {
                                /**
                                 * @description 用户 ID
                                 * @example 1
                                 */
                                id: number;
                                /**
                                 * @description 用户名
                                 * @example alice
                                 */
                                name: string;
                                /**
                                 * @description 备注
                                 * @example null
                                 */
                                note: string | null;
                                /**
                                 * @description 角色
                                 * @example user
                                 * @enum {string}
                                 */
                                role: "admin" | "user";
                                /**
                                 * @description 每分钟请求数限制；null 表示不限制
                                 * @example 60
                                 */
                                rpm: number | null;
                                /**
                                 * @description 每日消费额度（USD）；null 表示不限制
                                 * @example 50
                                 */
                                dailyQuota: number | null;
                                /**
                                 * @description 供应商分组
                                 * @example default
                                 */
                                providerGroup: string | null;
                                /**
                                 * @description 用户标签
                                 * @example [
                                 *       "team-a"
                                 *     ]
                                 */
                                tags: string[];
                                /**
                                 * @description 是否启用
                                 * @example true
                                 */
                                isEnabled: boolean;
                                /**
                                 * Format: date-time
                                 * @description 过期时间（ISO 字符串）
                                 * @example 2025-04-28T13:45:00.000Z
                                 */
                                expiresAt: string | null;
                                /**
                                 * @description 5 小时消费上限
                                 * @example null
                                 */
                                limit5hUsd: number | null;
                                /**
                                 * @description 限额重置模式：固定窗口（fixed）或滚动窗口（rolling）
                                 * @example rolling
                                 * @enum {string}
                                 */
                                limit5hResetMode?: "fixed" | "rolling";
                                /**
                                 * @description 周消费上限
                                 * @example null
                                 */
                                limitWeeklyUsd: number | null;
                                /**
                                 * @description 月消费上限
                                 * @example null
                                 */
                                limitMonthlyUsd: number | null;
                                /**
                                 * @description 总消费上限
                                 * @example null
                                 */
                                limitTotalUsd: number | null;
                                /**
                                 * @description 并发会话上限
                                 * @example null
                                 */
                                limitConcurrentSessions: number | null;
                                /**
                                 * @description 限额重置模式：固定窗口（fixed）或滚动窗口（rolling）
                                 * @example rolling
                                 * @enum {string}
                                 */
                                dailyResetMode?: "fixed" | "rolling";
                                /**
                                 * @description 每日重置时间 HH:mm
                                 * @example 00:00
                                 */
                                dailyResetTime?: string;
                                /**
                                 * @description 允许的客户端模式
                                 * @example []
                                 */
                                allowedClients: string[];
                                /**
                                 * @description 禁止的客户端模式
                                 * @example []
                                 */
                                blockedClients: string[];
                                /**
                                 * @description 允许的模型
                                 * @example []
                                 */
                                allowedModels: string[];
                                /** @description 用户名下的 key 列表（已脱敏） */
                                keys: {
                                    /**
                                     * @description Key 主键
                                     * @example 100
                                     */
                                    id: number;
                                    /**
                                     * @description Key 名称
                                     * @example default
                                     */
                                    name: string;
                                    /**
                                     * @description 脱敏后的 key 字符串
                                     * @example sk-A•••••B0c1
                                     */
                                    maskedKey: string;
                                    /**
                                     * @description Key 是否启用
                                     * @example true
                                     */
                                    isEnabled: boolean;
                                    /**
                                     * @description 是否允许使用此 key 登录 Web UI
                                     * @example true
                                     */
                                    canLoginWebUi: boolean;
                                    /**
                                     * @description Key 的供应商分组覆盖；null 表示沿用用户分组
                                     * @example default
                                     */
                                    providerGroup: string | null;
                                    /**
                                     * @description 过期时间（ISO 字符串或 'neverExpires' 标识；按用户语言本地化）
                                     * @example neverExpires
                                     */
                                    expiresAt: string | null;
                                    /**
                                     * @description 5 小时消费上限
                                     * @example null
                                     */
                                    limit5hUsd: number | null;
                                    /**
                                     * @description 限额重置模式：固定窗口（fixed）或滚动窗口（rolling）
                                     * @example rolling
                                     * @enum {string}
                                     */
                                    limit5hResetMode: "fixed" | "rolling";
                                    /**
                                     * @description 每日消费上限
                                     * @example 10
                                     */
                                    limitDailyUsd: number | null;
                                    /**
                                     * @description 限额重置模式：固定窗口（fixed）或滚动窗口（rolling）
                                     * @example rolling
                                     * @enum {string}
                                     */
                                    dailyResetMode: "fixed" | "rolling";
                                    /**
                                     * @description 每日重置时间 (HH:mm)
                                     * @example 00:00
                                     */
                                    dailyResetTime: string;
                                    /**
                                     * @description 周消费上限
                                     * @example null
                                     */
                                    limitWeeklyUsd: number | null;
                                    /**
                                     * @description 月消费上限
                                     * @example null
                                     */
                                    limitMonthlyUsd: number | null;
                                    /**
                                     * @description 总消费上限
                                     * @example null
                                     */
                                    limitTotalUsd?: number | null;
                                    /**
                                     * @description 并发会话上限；0 表示不限制
                                     * @example 0
                                     */
                                    limitConcurrentSessions: number;
                                }[];
                            }[];
                            /** @description 游标分页元数据 */
                            pageInfo: {
                                /**
                                 * @description 下一页游标；null 表示无更多
                                 * @example null
                                 */
                                nextCursor: string | null;
                                /**
                                 * @description 是否还有更多数据
                                 * @example false
                                 */
                                hasMore: boolean;
                                /**
                                 * @description 本次返回的最大条数
                                 * @example 50
                                 */
                                limit: number;
                            };
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        /**
         * 创建用户（同时生成默认 key）
         * @description 创建一个新用户并同步生成默认 key；响应中 defaultKey.key 是原始 API key 字符串，**仅在此响应里出现一次**。需要管理员权限，cookie 鉴权时必须携带 X-CCH-CSRF。
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name: string;
                        /** @default  */
                        note?: string;
                        /** @default  */
                        providerGroup?: string | null;
                        /** @default [] */
                        tags?: string[];
                        rpm?: number | null;
                        dailyQuota?: number | null;
                        limit5hUsd?: number | null;
                        /**
                         * @default rolling
                         * @enum {string}
                         */
                        limit5hResetMode?: "fixed" | "rolling";
                        limitWeeklyUsd?: number | null;
                        limitMonthlyUsd?: number | null;
                        limitTotalUsd?: number | null;
                        limitConcurrentSessions?: number | null;
                        /** @default true */
                        isEnabled?: boolean;
                        /** Format: date-time */
                        expiresAt?: string | null;
                        /**
                         * @default fixed
                         * @enum {string}
                         */
                        dailyResetMode?: "fixed" | "rolling";
                        /** @default 00:00 */
                        dailyResetTime?: string;
                        /** @default [] */
                        allowedClients?: string[] | null;
                        /** @default [] */
                        blockedClients?: string[] | null;
                        /** @default [] */
                        allowedModels?: string[];
                    };
                };
            };
            responses: {
                /** @description 用户创建成功 */
                201: {
                    headers: {
                        /** @description 新用户的相对 URL */
                        Location?: string;
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @description 新建的用户 */
                            user: {
                                /**
                                 * @description 用户 ID
                                 * @example 1
                                 */
                                id: number;
                                /**
                                 * @description 用户名
                                 * @example alice
                                 */
                                name: string;
                                /**
                                 * @description 备注
                                 * @example null
                                 */
                                note?: string | null;
                                /**
                                 * @description 角色
                                 * @example user
                                 * @enum {string}
                                 */
                                role: "admin" | "user";
                                /**
                                 * @description 是否启用
                                 * @example true
                                 */
                                isEnabled: boolean;
                                /**
                                 * Format: date-time
                                 * @description 过期时间（ISO 字符串）
                                 * @example 2025-04-28T13:45:00.000Z
                                 */
                                expiresAt: string | null;
                                /**
                                 * @description 每分钟请求数限制
                                 * @example 60
                                 */
                                rpm: number | null;
                                /**
                                 * @description 每日消费额度
                                 * @example 50
                                 */
                                dailyQuota: number | null;
                                /**
                                 * @description 供应商分组
                                 * @example default
                                 */
                                providerGroup?: string | null;
                                /**
                                 * @description 标签
                                 * @example []
                                 */
                                tags: string[];
                                /**
                                 * @description 5 小时上限
                                 * @example null
                                 */
                                limit5hUsd: number | null;
                                /**
                                 * @description 限额重置模式：固定窗口（fixed）或滚动窗口（rolling）
                                 * @example rolling
                                 * @enum {string}
                                 */
                                limit5hResetMode: "fixed" | "rolling";
                                /**
                                 * @description 周上限
                                 * @example null
                                 */
                                limitWeeklyUsd: number | null;
                                /**
                                 * @description 月上限
                                 * @example null
                                 */
                                limitMonthlyUsd: number | null;
                                /**
                                 * @description 总上限
                                 * @example null
                                 */
                                limitTotalUsd: number | null;
                                /**
                                 * @description 并发上限
                                 * @example null
                                 */
                                limitConcurrentSessions: number | null;
                                /**
                                 * @description 允许的模型
                                 * @example []
                                 */
                                allowedModels: string[];
                            };
                            /** @description addUser 同步创建的默认 key（包含原始 key 字符串，仅暴露一次） */
                            defaultKey: {
                                /**
                                 * @description 默认 key 主键
                                 * @example 100
                                 */
                                id: number;
                                /**
                                 * @description 默认 key 名称
                                 * @example default
                                 */
                                name: string;
                                /**
                                 * @description 新创建的原始 API key 字符串。**仅在此响应中返回一次**；后续读接口仅回传脱敏字符串。
                                 * @example sk-abcdef0123456789abcdef0123456789
                                 */
                                key: string;
                            };
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 列出所有用户标签
         * @description 返回去重后的用户标签集合，用于筛选下拉框。需要管理员权限。
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 用户标签列表 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /**
                             * @description 用户标签集合（去重）
                             * @example [
                             *       "team-a",
                             *       "team-b"
                             *     ]
                             */
                            items: string[];
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/key-groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 列出所有用户 key 分组
         * @description 返回去重后的用户 key 分组集合，用于筛选下拉框。需要管理员权限。
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Key 分组列表 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /**
                             * @description 用户 key 分组集合（去重）
                             * @example [
                             *       "default",
                             *       "claude-only"
                             *     ]
                             */
                            items: string[];
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询单个用户
         * @description 通过数字 id 获取单个用户；敏感字段已脱敏。需要管理员权限。
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 用户详情 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /**
                             * @description 用户 ID
                             * @example 1
                             */
                            id: number;
                            /**
                             * @description 用户名
                             * @example alice
                             */
                            name: string;
                            /**
                             * @description 备注
                             * @example null
                             */
                            note: string | null;
                            /**
                             * @description 角色
                             * @example user
                             * @enum {string}
                             */
                            role: "admin" | "user";
                            /**
                             * @description 每分钟请求数限制；null 表示不限制
                             * @example 60
                             */
                            rpm: number | null;
                            /**
                             * @description 每日消费额度（USD）；null 表示不限制
                             * @example 50
                             */
                            dailyQuota: number | null;
                            /**
                             * @description 供应商分组
                             * @example default
                             */
                            providerGroup: string | null;
                            /**
                             * @description 用户标签
                             * @example [
                             *       "team-a"
                             *     ]
                             */
                            tags: string[];
                            /**
                             * @description 是否启用
                             * @example true
                             */
                            isEnabled: boolean;
                            /**
                             * Format: date-time
                             * @description 过期时间（ISO 字符串）
                             * @example 2025-04-28T13:45:00.000Z
                             */
                            expiresAt: string | null;
                            /**
                             * @description 5 小时消费上限
                             * @example null
                             */
                            limit5hUsd: number | null;
                            /**
                             * @description 限额重置模式：固定窗口（fixed）或滚动窗口（rolling）
                             * @example rolling
                             * @enum {string}
                             */
                            limit5hResetMode?: "fixed" | "rolling";
                            /**
                             * @description 周消费上限
                             * @example null
                             */
                            limitWeeklyUsd: number | null;
                            /**
                             * @description 月消费上限
                             * @example null
                             */
                            limitMonthlyUsd: number | null;
                            /**
                             * @description 总消费上限
                             * @example null
                             */
                            limitTotalUsd: number | null;
                            /**
                             * @description 并发会话上限
                             * @example null
                             */
                            limitConcurrentSessions: number | null;
                            /**
                             * @description 限额重置模式：固定窗口（fixed）或滚动窗口（rolling）
                             * @example rolling
                             * @enum {string}
                             */
                            dailyResetMode?: "fixed" | "rolling";
                            /**
                             * @description 每日重置时间 HH:mm
                             * @example 00:00
                             */
                            dailyResetTime?: string;
                            /**
                             * @description 允许的客户端模式
                             * @example []
                             */
                            allowedClients: string[];
                            /**
                             * @description 禁止的客户端模式
                             * @example []
                             */
                            blockedClients: string[];
                            /**
                             * @description 允许的模型
                             * @example []
                             */
                            allowedModels: string[];
                            /** @description 用户名下的 key 列表（已脱敏） */
                            keys: {
                                /**
                                 * @description Key 主键
                                 * @example 100
                                 */
                                id: number;
                                /**
                                 * @description Key 名称
                                 * @example default
                                 */
                                name: string;
                                /**
                                 * @description 脱敏后的 key 字符串
                                 * @example sk-A•••••B0c1
                                 */
                                maskedKey: string;
                                /**
                                 * @description Key 是否启用
                                 * @example true
                                 */
                                isEnabled: boolean;
                                /**
                                 * @description 是否允许使用此 key 登录 Web UI
                                 * @example true
                                 */
                                canLoginWebUi: boolean;
                                /**
                                 * @description Key 的供应商分组覆盖；null 表示沿用用户分组
                                 * @example default
                                 */
                                providerGroup: string | null;
                                /**
                                 * @description 过期时间（ISO 字符串或 'neverExpires' 标识；按用户语言本地化）
                                 * @example neverExpires
                                 */
                                expiresAt: string | null;
                                /**
                                 * @description 5 小时消费上限
                                 * @example null
                                 */
                                limit5hUsd: number | null;
                                /**
                                 * @description 限额重置模式：固定窗口（fixed）或滚动窗口（rolling）
                                 * @example rolling
                                 * @enum {string}
                                 */
                                limit5hResetMode: "fixed" | "rolling";
                                /**
                                 * @description 每日消费上限
                                 * @example 10
                                 */
                                limitDailyUsd: number | null;
                                /**
                                 * @description 限额重置模式：固定窗口（fixed）或滚动窗口（rolling）
                                 * @example rolling
                                 * @enum {string}
                                 */
                                dailyResetMode: "fixed" | "rolling";
                                /**
                                 * @description 每日重置时间 (HH:mm)
                                 * @example 00:00
                                 */
                                dailyResetTime: string;
                                /**
                                 * @description 周消费上限
                                 * @example null
                                 */
                                limitWeeklyUsd: number | null;
                                /**
                                 * @description 月消费上限
                                 * @example null
                                 */
                                limitMonthlyUsd: number | null;
                                /**
                                 * @description 总消费上限
                                 * @example null
                                 */
                                limitTotalUsd?: number | null;
                                /**
                                 * @description 并发会话上限；0 表示不限制
                                 * @example 0
                                 */
                                limitConcurrentSessions: number;
                            }[];
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        /**
         * 删除用户
         * @description 删除指定用户（软删）；幂等。Cookie 鉴权时必须携带 X-CCH-CSRF。
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 删除成功（无响应体） */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        /**
         * 更新用户
         * @description 局部更新一个用户；未提供的字段保持原值。Cookie 鉴权时必须携带 X-CCH-CSRF。
         */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name?: string;
                        note?: string;
                        providerGroup?: string | null;
                        tags?: string[];
                        rpm?: number | null;
                        dailyQuota?: number | null;
                        limit5hUsd?: number | null;
                        /** @enum {string} */
                        limit5hResetMode?: "fixed" | "rolling";
                        limitWeeklyUsd?: number | null;
                        limitMonthlyUsd?: number | null;
                        limitTotalUsd?: number | null;
                        limitConcurrentSessions?: number | null;
                        isEnabled?: boolean;
                        /** Format: date-time */
                        expiresAt?: string | null;
                        /** @enum {string} */
                        dailyResetMode?: "fixed" | "rolling";
                        dailyResetTime?: string;
                        allowedClients?: string[] | null;
                        blockedClients?: string[] | null;
                        allowedModels?: string[];
                    };
                };
            };
            responses: {
                /** @description 更新后的用户 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /**
                             * @description 用户 ID
                             * @example 1
                             */
                            id: number;
                            /**
                             * @description 用户名
                             * @example alice
                             */
                            name: string;
                            /**
                             * @description 备注
                             * @example null
                             */
                            note: string | null;
                            /**
                             * @description 角色
                             * @example user
                             * @enum {string}
                             */
                            role: "admin" | "user";
                            /**
                             * @description 每分钟请求数限制；null 表示不限制
                             * @example 60
                             */
                            rpm: number | null;
                            /**
                             * @description 每日消费额度（USD）；null 表示不限制
                             * @example 50
                             */
                            dailyQuota: number | null;
                            /**
                             * @description 供应商分组
                             * @example default
                             */
                            providerGroup: string | null;
                            /**
                             * @description 用户标签
                             * @example [
                             *       "team-a"
                             *     ]
                             */
                            tags: string[];
                            /**
                             * @description 是否启用
                             * @example true
                             */
                            isEnabled: boolean;
                            /**
                             * Format: date-time
                             * @description 过期时间（ISO 字符串）
                             * @example 2025-04-28T13:45:00.000Z
                             */
                            expiresAt: string | null;
                            /**
                             * @description 5 小时消费上限
                             * @example null
                             */
                            limit5hUsd: number | null;
                            /**
                             * @description 限额重置模式：固定窗口（fixed）或滚动窗口（rolling）
                             * @example rolling
                             * @enum {string}
                             */
                            limit5hResetMode?: "fixed" | "rolling";
                            /**
                             * @description 周消费上限
                             * @example null
                             */
                            limitWeeklyUsd: number | null;
                            /**
                             * @description 月消费上限
                             * @example null
                             */
                            limitMonthlyUsd: number | null;
                            /**
                             * @description 总消费上限
                             * @example null
                             */
                            limitTotalUsd: number | null;
                            /**
                             * @description 并发会话上限
                             * @example null
                             */
                            limitConcurrentSessions: number | null;
                            /**
                             * @description 限额重置模式：固定窗口（fixed）或滚动窗口（rolling）
                             * @example rolling
                             * @enum {string}
                             */
                            dailyResetMode?: "fixed" | "rolling";
                            /**
                             * @description 每日重置时间 HH:mm
                             * @example 00:00
                             */
                            dailyResetTime?: string;
                            /**
                             * @description 允许的客户端模式
                             * @example []
                             */
                            allowedClients: string[];
                            /**
                             * @description 禁止的客户端模式
                             * @example []
                             */
                            blockedClients: string[];
                            /**
                             * @description 允许的模型
                             * @example []
                             */
                            allowedModels: string[];
                            /** @description 用户名下的 key 列表（已脱敏） */
                            keys: {
                                /**
                                 * @description Key 主键
                                 * @example 100
                                 */
                                id: number;
                                /**
                                 * @description Key 名称
                                 * @example default
                                 */
                                name: string;
                                /**
                                 * @description 脱敏后的 key 字符串
                                 * @example sk-A•••••B0c1
                                 */
                                maskedKey: string;
                                /**
                                 * @description Key 是否启用
                                 * @example true
                                 */
                                isEnabled: boolean;
                                /**
                                 * @description 是否允许使用此 key 登录 Web UI
                                 * @example true
                                 */
                                canLoginWebUi: boolean;
                                /**
                                 * @description Key 的供应商分组覆盖；null 表示沿用用户分组
                                 * @example default
                                 */
                                providerGroup: string | null;
                                /**
                                 * @description 过期时间（ISO 字符串或 'neverExpires' 标识；按用户语言本地化）
                                 * @example neverExpires
                                 */
                                expiresAt: string | null;
                                /**
                                 * @description 5 小时消费上限
                                 * @example null
                                 */
                                limit5hUsd: number | null;
                                /**
                                 * @description 限额重置模式：固定窗口（fixed）或滚动窗口（rolling）
                                 * @example rolling
                                 * @enum {string}
                                 */
                                limit5hResetMode: "fixed" | "rolling";
                                /**
                                 * @description 每日消费上限
                                 * @example 10
                                 */
                                limitDailyUsd: number | null;
                                /**
                                 * @description 限额重置模式：固定窗口（fixed）或滚动窗口（rolling）
                                 * @example rolling
                                 * @enum {string}
                                 */
                                dailyResetMode: "fixed" | "rolling";
                                /**
                                 * @description 每日重置时间 (HH:mm)
                                 * @example 00:00
                                 */
                                dailyResetTime: string;
                                /**
                                 * @description 周消费上限
                                 * @example null
                                 */
                                limitWeeklyUsd: number | null;
                                /**
                                 * @description 月消费上限
                                 * @example null
                                 */
                                limitMonthlyUsd: number | null;
                                /**
                                 * @description 总消费上限
                                 * @example null
                                 */
                                limitTotalUsd?: number | null;
                                /**
                                 * @description 并发会话上限；0 表示不限制
                                 * @example 0
                                 */
                                limitConcurrentSessions: number;
                            }[];
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/users/{id}:enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 切换用户启用状态
         * @description 把用户置为启用 / 禁用；Cookie 鉴权时必须携带 X-CCH-CSRF。
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description 目标启用状态
                         * @example false
                         */
                        enabled: boolean;
                    };
                };
            };
            responses: {
                /** @description 切换成功 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok?: boolean;
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{id}:renew": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 续期用户
         * @description 更新用户的过期时间；可选同时启用用户。Cookie 鉴权时必须携带 X-CCH-CSRF。
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description 新的过期时间（ISO 8601 字符串，null 表示永不过期）
                         * @example 2026-12-31T23:59:59Z
                         */
                        expiresAt: string | null;
                        /**
                         * @description 是否同时启用用户
                         * @example true
                         */
                        enableUser?: boolean;
                    };
                };
            };
            responses: {
                /** @description 续期成功 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok?: boolean;
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{id}/limits:reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 重置用户限额
         * @description 设置 costResetAt = NOW() 让所有花销统计从此刻起重新累计；不会删除日志或统计数据。需要管理员权限。
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 重置成功 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok?: boolean;
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{userId}/keys": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 列出用户的 keys
         * @description 返回指定用户的 key 列表（已脱敏）。可附 `?include=statistics` 同时返回各 key 的统计数据。
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description 用户 ID */
                    userId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Key 列表 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @description Key 列表（已脱敏） */
                            items: {
                                /**
                                 * @description Key 主键
                                 * @example 100
                                 */
                                id: number;
                                /**
                                 * @description 所属用户 ID
                                 * @example 1
                                 */
                                userId: number;
                                /**
                                 * @description Key 名称
                                 * @example default
                                 */
                                name: string;
                                /**
                                 * @description 是否启用
                                 * @example true
                                 */
                                isEnabled: boolean;
                                /**
                                 * @description 是否允许使用此 key 登录 Web UI
                                 * @example true
                                 */
                                canLoginWebUi: boolean;
                                /**
                                 * @description 供应商分组覆盖；null 表示沿用用户分组
                                 * @example default
                                 */
                                providerGroup: string | null;
                                /**
                                 * Format: date-time
                                 * @description 过期时间（ISO 字符串）；null = 永不过期
                                 * @example 2025-04-28T13:45:00.000Z
                                 */
                                expiresAt: string | null;
                                /**
                                 * @description 5 小时消费上限
                                 * @example null
                                 */
                                limit5hUsd: number | null;
                                /**
                                 * @description 限额重置模式
                                 * @example rolling
                                 * @enum {string}
                                 */
                                limit5hResetMode: "fixed" | "rolling";
                                /**
                                 * @description 每日消费上限
                                 * @example 10
                                 */
                                limitDailyUsd: number | null;
                                /**
                                 * @description 限额重置模式
                                 * @example rolling
                                 * @enum {string}
                                 */
                                dailyResetMode: "fixed" | "rolling";
                                /**
                                 * @description 每日重置时间 (HH:mm)
                                 * @example 00:00
                                 */
                                dailyResetTime: string;
                                /**
                                 * @description 周消费上限
                                 * @example null
                                 */
                                limitWeeklyUsd: number | null;
                                /**
                                 * @description 月消费上限
                                 * @example null
                                 */
                                limitMonthlyUsd: number | null;
                                /**
                                 * @description 总消费上限
                                 * @example null
                                 */
                                limitTotalUsd: number | null;
                                /**
                                 * @description 并发会话上限；0 表示不限制
                                 * @example 0
                                 */
                                limitConcurrentSessions: number;
                                /**
                                 * @description 缓存 TTL 偏好
                                 * @example inherit
                                 * @enum {string|null}
                                 */
                                cacheTtlPreference: "inherit" | "5m" | "1h" | null;
                                /**
                                 * Format: date-time
                                 * @description 软重置时间（ISO 字符串）
                                 * @example 2025-04-28T13:45:00.000Z
                                 */
                                costResetAt: string | null;
                                /**
                                 * Format: date-time
                                 * @description 创建时间（ISO 字符串）
                                 * @example 2025-04-28T13:45:00.000Z
                                 */
                                createdAt: string | null;
                                /**
                                 * Format: date-time
                                 * @description 更新时间（ISO 字符串）
                                 * @example 2025-04-28T13:45:00.000Z
                                 */
                                updatedAt: string | null;
                                /**
                                 * @description 脱敏后的 key 字符串（原始 key 仅在创建时返回一次）
                                 * @example sk-A•••••B0c1
                                 */
                                key: string;
                            }[];
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        /**
         * 为用户创建 key
         * @description 为指定用户创建一个新的 key；响应中 `key` 字段是原始 API key 字符串，**仅在此响应里出现一次**，调用方应立即让用户保存。需要管理员权限。
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description 用户 ID */
                    userId: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name: string;
                        /** @default  */
                        expiresAt?: string;
                        /** @default true */
                        canLoginWebUi?: boolean;
                        limit5hUsd?: number | null;
                        /**
                         * @default rolling
                         * @enum {string}
                         */
                        limit5hResetMode?: "fixed" | "rolling";
                        limitDailyUsd?: number | null;
                        /**
                         * @default fixed
                         * @enum {string}
                         */
                        dailyResetMode?: "fixed" | "rolling";
                        /** @default 00:00 */
                        dailyResetTime?: string;
                        limitWeeklyUsd?: number | null;
                        limitMonthlyUsd?: number | null;
                        limitTotalUsd?: number | null;
                        /** @default 0 */
                        limitConcurrentSessions?: number | null;
                        /** @default  */
                        providerGroup?: string | null;
                        /**
                         * @default inherit
                         * @enum {string}
                         */
                        cacheTtlPreference?: "inherit" | "5m" | "1h";
                        /**
                         * @description 是否启用此 key
                         * @example true
                         */
                        isEnabled?: boolean;
                    };
                };
            };
            responses: {
                /** @description Key 创建成功；Location 指向新 key */
                201: {
                    headers: {
                        /** @description 新 key 的相对 URL */
                        Location?: string;
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /**
                             * @description 新 key 主键
                             * @example 100
                             */
                            id: number;
                            /**
                             * @description Key 名称
                             * @example default
                             */
                            name: string;
                            /**
                             * @description 新创建的原始 API key 字符串。**仅在创建响应中返回一次**；后续读接口仅回传脱敏字符串。
                             * @example sk-abcdef0123456789abcdef0123456789
                             */
                            key: string;
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/keys/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * 删除 key
         * @description 删除指定 key；幂等。Cookie 鉴权时必须携带 X-CCH-CSRF。
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 删除成功（无响应体） */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        /**
         * 更新 key
         * @description 局部更新一个 key；未提供的字段保持原值。Cookie 鉴权时必须携带 X-CCH-CSRF。
         */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name?: string;
                        /** @default  */
                        expiresAt?: string;
                        /** @default true */
                        canLoginWebUi?: boolean;
                        limit5hUsd?: number | null;
                        /**
                         * @default rolling
                         * @enum {string}
                         */
                        limit5hResetMode?: "fixed" | "rolling";
                        limitDailyUsd?: number | null;
                        /**
                         * @default fixed
                         * @enum {string}
                         */
                        dailyResetMode?: "fixed" | "rolling";
                        /** @default 00:00 */
                        dailyResetTime?: string;
                        limitWeeklyUsd?: number | null;
                        limitMonthlyUsd?: number | null;
                        limitTotalUsd?: number | null;
                        /** @default 0 */
                        limitConcurrentSessions?: number | null;
                        /** @default  */
                        providerGroup?: string | null;
                        /**
                         * @default inherit
                         * @enum {string}
                         */
                        cacheTtlPreference?: "inherit" | "5m" | "1h";
                        /**
                         * @description 是否启用此 key
                         * @example true
                         */
                        isEnabled?: boolean;
                    };
                };
            };
            responses: {
                /** @description 更新成功 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok?: boolean;
                            id?: number;
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/keys/{id}:enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 切换 key 启用状态
         * @description 把 key 置为启用 / 禁用；Cookie 鉴权时必须携带 X-CCH-CSRF。
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description 目标启用状态
                         * @example false
                         */
                        enabled: boolean;
                    };
                };
            };
            responses: {
                /** @description 切换成功 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok?: boolean;
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/keys/{id}:renew": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 续期 key
         * @description 更新 key 的过期时间；可选同时启用 key。Cookie 鉴权时必须携带 X-CCH-CSRF。
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description 新的过期时间（ISO 8601 字符串）
                         * @example 2026-12-31T23:59:59Z
                         */
                        expiresAt: string;
                        /**
                         * @description 是否同时启用 key
                         * @example true
                         */
                        enableKey?: boolean;
                    };
                };
            };
            responses: {
                /** @description 续期成功 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok?: boolean;
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/keys/{id}/limits:reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 重置 key 限额
         * @description 设置 key.costResetAt = NOW()，让所有花销重新累计；不删日志。需要管理员权限。
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 重置成功 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok?: boolean;
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/keys/{id}/limit-usage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询 key 实时限额使用情况
         * @description 返回 key 的 5h / daily / weekly / monthly / total / concurrentSessions 实时使用量。Read tier；普通用户只能查询自己的 key（由 action 内部校验）。
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 限额使用情况 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @description 5 小时消费 */
                            cost5h: {
                                /**
                                 * @description 当前已使用值
                                 * @example 1.23
                                 */
                                current: number;
                                /**
                                 * @description 上限；null 表示不限制
                                 * @example 10
                                 */
                                limit: number | null;
                                /**
                                 * Format: date-time
                                 * @description 下次重置时间（ISO 字符串）
                                 * @example 2025-04-28T13:45:00.000Z
                                 */
                                resetAt?: string;
                            };
                            /** @description 每日消费 */
                            costDaily: {
                                /**
                                 * @description 当前已使用值
                                 * @example 1.23
                                 */
                                current: number;
                                /**
                                 * @description 上限；null 表示不限制
                                 * @example 10
                                 */
                                limit: number | null;
                                /**
                                 * Format: date-time
                                 * @description 下次重置时间（ISO 字符串）
                                 * @example 2025-04-28T13:45:00.000Z
                                 */
                                resetAt?: string;
                            };
                            /** @description 每周消费 */
                            costWeekly: {
                                /**
                                 * @description 当前已使用值
                                 * @example 1.23
                                 */
                                current: number;
                                /**
                                 * @description 上限；null 表示不限制
                                 * @example 10
                                 */
                                limit: number | null;
                                /**
                                 * Format: date-time
                                 * @description 下次重置时间（ISO 字符串）
                                 * @example 2025-04-28T13:45:00.000Z
                                 */
                                resetAt?: string;
                            };
                            /** @description 每月消费 */
                            costMonthly: {
                                /**
                                 * @description 当前已使用值
                                 * @example 1.23
                                 */
                                current: number;
                                /**
                                 * @description 上限；null 表示不限制
                                 * @example 10
                                 */
                                limit: number | null;
                                /**
                                 * Format: date-time
                                 * @description 下次重置时间（ISO 字符串）
                                 * @example 2025-04-28T13:45:00.000Z
                                 */
                                resetAt?: string;
                            };
                            /** @description 总消费 */
                            costTotal: {
                                /**
                                 * @description 当前已使用值
                                 * @example 1.23
                                 */
                                current: number;
                                /**
                                 * @description 上限；null 表示不限制
                                 * @example 10
                                 */
                                limit: number | null;
                                /**
                                 * Format: date-time
                                 * @description 下次重置时间（ISO 字符串）
                                 * @example 2025-04-28T13:45:00.000Z
                                 */
                                resetAt?: string;
                            };
                            /** @description 并发会话限额使用情况 */
                            concurrentSessions: {
                                /**
                                 * @description 当前并发会话数
                                 * @example 0
                                 */
                                current: number;
                                /**
                                 * @description 并发会话上限
                                 * @example 0
                                 */
                                limit: number;
                            };
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限或 CSRF 校验失败 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users/{id}/insights/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 用户洞察 - 概览指标
         * @description 返回指定用户在给定日期范围内的请求数 / 总花费 / 平均响应时间 / 错误率。
         */
        get: {
            parameters: {
                query?: {
                    /** @description 起始日期 */
                    startDate?: string;
                    /** @description 结束日期 */
                    endDate?: string;
                };
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 概览指标 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @description 用户信息（用于 insights overview 头部展示） */
                            user: {
                                /**
                                 * @description 用户 ID
                                 * @example 1
                                 */
                                id: number;
                                /**
                                 * @description 用户名
                                 * @example alice
                                 */
                                name: string;
                                /**
                                 * @description 用户描述
                                 * @example
                                 */
                                description: string;
                                /**
                                 * @description 角色
                                 * @example user
                                 * @enum {string}
                                 */
                                role: "admin" | "user";
                                /**
                                 * @description 是否启用
                                 * @example true
                                 */
                                isEnabled: boolean;
                                /**
                                 * Format: date-time
                                 * @description 过期时间
                                 * @example 2025-04-28T13:45:00.000Z
                                 */
                                expiresAt: string | null;
                                /**
                                 * Format: date-time
                                 * @description 创建时间
                                 * @example 2025-04-28T13:45:00.000Z
                                 */
                                createdAt: string;
                                /**
                                 * Format: date-time
                                 * @description 更新时间
                                 * @example 2025-04-28T13:45:00.000Z
                                 */
                                updatedAt: string;
                            };
                            /** @description 用户洞察核心指标 */
                            overview: {
                                /**
                                 * @description 请求总数
                                 * @example 1234
                                 */
                                requestCount: number;
                                /**
                                 * @description 总花费（USD）
                                 * @example 12.34
                                 */
                                totalCost: number;
                                /**
                                 * @description 平均响应时间（ms）
                                 * @example 850
                                 */
                                avgResponseTime: number;
                                /**
                                 * @description 错误率（0-1）
                                 * @example 0.01
                                 */
                                errorRate: number;
                            };
                            /**
                             * @description 货币代码
                             * @example USD
                             */
                            currencyCode: string;
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users/{id}/insights/key-trend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 用户洞察 - Key 趋势
         * @description 按预设的 timeRange 聚合，返回该用户每个 key 每日（或每小时）的调用 / 花费数据。
         */
        get: {
            parameters: {
                query: {
                    /** @description 时间范围预设 */
                    timeRange: "today" | "7days" | "30days" | "thisMonth";
                };
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Key 趋势数据 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @description Key 趋势数据 */
                            items: {
                                /**
                                 * @description Key 主键
                                 * @example 100
                                 */
                                key_id: number;
                                /**
                                 * @description Key 名称
                                 * @example default
                                 */
                                key_name: string;
                                /**
                                 * @description 日期或时间戳
                                 * @example 2026-04-01
                                 */
                                date: string;
                                /**
                                 * @description 调用次数
                                 * @example 12
                                 */
                                api_calls: number;
                                /**
                                 * @description 总花费（DB 原始值）
                                 * @example 1.23
                                 */
                                total_cost: string | number | null;
                            }[];
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users/{id}/insights/model-breakdown": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 用户洞察 - 模型维度统计
         * @description 按模型聚合用户的调用次数 / 花费 / token 等数据；可附加 keyId / providerId 过滤。
         */
        get: {
            parameters: {
                query?: {
                    /** @description 起始日期 */
                    startDate?: string;
                    /** @description 结束日期 */
                    endDate?: string;
                    /** @description 仅看指定 key 的数据 */
                    keyId?: number;
                    /** @description 仅看指定 provider 的数据 */
                    providerId?: number;
                };
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 模型维度统计 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @description 按模型聚合的数据 */
                            breakdown: {
                                /**
                                 * @description 模型名
                                 * @example claude-sonnet-4
                                 */
                                model: string | null;
                                /**
                                 * @description 请求数
                                 * @example 100
                                 */
                                requests: number;
                                /**
                                 * @description 总花费
                                 * @example 1.23
                                 */
                                cost: number;
                                /**
                                 * @description 输入 token
                                 * @example 5000
                                 */
                                inputTokens: number;
                                /**
                                 * @description 输出 token
                                 * @example 2000
                                 */
                                outputTokens: number;
                                /**
                                 * @description cache 写入 token
                                 * @example 0
                                 */
                                cacheCreationTokens: number;
                                /**
                                 * @description cache 读取 token
                                 * @example 0
                                 */
                                cacheReadTokens: number;
                            }[];
                            /**
                             * @description 货币代码
                             * @example USD
                             */
                            currencyCode: string;
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users/{id}/insights/provider-breakdown": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 用户洞察 - Provider 维度统计
         * @description 按 provider 聚合用户的调用次数 / 花费 / token 等数据；可附加 keyId / model 过滤。
         */
        get: {
            parameters: {
                query?: {
                    /** @description 起始日期 */
                    startDate?: string;
                    /** @description 结束日期 */
                    endDate?: string;
                    /** @description 仅看指定 key 的数据 */
                    keyId?: number;
                    /** @description 仅看指定 model 的数据 */
                    model?: string;
                };
                header?: never;
                path: {
                    /** @description Resource numeric id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Provider 维度统计 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @description 按 provider 聚合的数据 */
                            breakdown: {
                                /**
                                 * @description Provider 主键
                                 * @example 1
                                 */
                                providerId: number;
                                /**
                                 * @description Provider 名
                                 * @example anthropic
                                 */
                                providerName: string | null;
                                /**
                                 * @description 请求数
                                 * @example 50
                                 */
                                requests: number;
                                /**
                                 * @description 总花费
                                 * @example 0.5
                                 */
                                cost: number;
                                /**
                                 * @description 输入 token
                                 * @example 1000
                                 */
                                inputTokens: number;
                                /**
                                 * @description 输出 token
                                 * @example 500
                                 */
                                outputTokens: number;
                                /**
                                 * @description cache 写入 token
                                 * @example 0
                                 */
                                cacheCreationTokens: number;
                                /**
                                 * @description cache 读取 token
                                 * @example 0
                                 */
                                cacheReadTokens: number;
                            }[];
                            /**
                             * @description 货币代码
                             * @example USD
                             */
                            currencyCode: string;
                        };
                    };
                };
                /** @description 请求参数无效 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 未认证 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 无权限 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 资源不存在 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
                /** @description 服务器内部错误 */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": {
                            /** @description URI identifying the problem type; about:blank when not applicable */
                            type: string;
                            /** @description Short, human-readable summary of the problem */
                            title: string;
                            /** @description HTTP status code mirroring the response */
                            status: number;
                            /** @description Human-readable explanation specific to this occurrence */
                            detail?: string;
                            /** @description URI reference identifying the request */
                            instance?: string;
                            /** @description Stable machine-readable error code for i18n / clients */
                            errorCode: string;
                            /** @description Parameters used to interpolate localized error messages */
                            errorParams?: {
                                [key: string]: string | number;
                            };
                            /** @description Per-request trace identifier; included in logs */
                            traceId: string;
                            /** @description List of invalid request parameters, when applicable */
                            invalidParams?: {
                                /** @description JSON path of the invalid field, root represented as [] */
                                path: (string | number)[];
                                /** @description Issue code (e.g. zod issue code) */
                                code: string;
                                /** @description Human-readable message */
                                message: string;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: never;
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;

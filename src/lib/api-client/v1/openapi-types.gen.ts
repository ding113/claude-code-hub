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

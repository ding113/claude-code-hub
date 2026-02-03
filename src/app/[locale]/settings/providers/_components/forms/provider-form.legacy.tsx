"use client";
import { ChevronDown, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { addProvider, editProvider, removeProvider } from "@/actions/providers";
import { getDistinctProviderGroupsAction } from "@/actions/request-filters";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTrigger,
  AlertDialogHeader as AlertHeader,
  AlertDialogTitle as AlertTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TagInput } from "@/components/ui/tag-input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PROVIDER_DEFAULTS, PROVIDER_TIMEOUT_DEFAULTS } from "@/lib/constants/provider.constants";
import { getProviderTypeConfig } from "@/lib/provider-type-utils";
import type { Context1mPreference } from "@/lib/special-attributes";
import {
  extractBaseUrl,
  isValidUrl,
  validateNumericField,
  validatePositiveDecimalField,
} from "@/lib/utils/validation";
import type {
  CodexParallelToolCallsPreference,
  CodexReasoningEffortPreference,
  CodexReasoningSummaryPreference,
  CodexTextVerbosityPreference,
  McpPassthroughType,
  ProviderDisplay,
  ProviderType,
} from "@/types/provider";
import { ModelMultiSelect } from "../model-multi-select";
import { ModelRedirectEditor } from "../model-redirect-editor";
import { ApiTestButton } from "./api-test-button";
import { ProxyTestButton } from "./proxy-test-button";
import { UrlPreview } from "./url-preview";

const GROUP_TAG_MAX_TOTAL_LENGTH = 50;

type Mode = "create" | "edit";

interface ProviderFormProps {
  mode: Mode;
  onSuccess?: () => void;
  provider?: ProviderDisplay; // edit 模式需要，create 可空
  cloneProvider?: ProviderDisplay; // create 模式用于克隆数据
  enableMultiProviderTypes: boolean;
  hideUrl?: boolean;
  hideWebsiteUrl?: boolean;
  preset?: {
    name?: string;
    url?: string;
    websiteUrl?: string;
    providerType?: ProviderType;
  };
  urlResolver?: (providerType: ProviderType) => Promise<string | null>;
  allowedProviderTypes?: ProviderType[];
}

function FieldLabelWithTooltip({
  label,
  tooltip,
  htmlFor,
}: {
  label: string;
  tooltip: string;
  htmlFor?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={`${label} - help`}
          >
            <Info className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-sm leading-relaxed">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export function ProviderForm({
  mode,
  onSuccess,
  provider,
  cloneProvider,
  enableMultiProviderTypes,
  hideUrl = false,
  hideWebsiteUrl = false,
  preset,
  urlResolver,
  allowedProviderTypes,
}: ProviderFormProps) {
  const t = useTranslations("settings.providers.form");
  const tUI = useTranslations("ui.tagInput");
  const tProviders = useTranslations("settings.providers");
  const isEdit = mode === "edit";
  const [isPending, startTransition] = useTransition();

  const renderProviderTypeLabel = (type: ProviderType) => {
    switch (type) {
      case "claude":
        return t("providerTypes.claude");
      case "claude-auth":
        return t("providerTypes.claudeAuth");
      case "codex":
        return t("providerTypes.codex");
      case "gemini":
        return t("providerTypes.gemini");
      case "gemini-cli":
        return t("providerTypes.geminiCli");
      case "openai-compatible":
        return enableMultiProviderTypes
          ? t("providerTypes.openaiCompatible")
          : `${t("providerTypes.openaiCompatible")}${t("providerTypes.openaiCompatibleDisabled")}`;
      default:
        return type;
    }
  };

  // 名称输入框引用，用于自动聚焦
  const nameInputRef = useRef<HTMLInputElement>(null);

  // 获取初始数据源：编辑模式用 provider，创建模式用 cloneProvider（如果有）
  const sourceProvider = isEdit ? provider : cloneProvider;

  const [name, setName] = useState(
    isEdit
      ? (provider?.name ?? "")
      : cloneProvider
        ? `${cloneProvider.name}_Copy`
        : (preset?.name ?? "")
  );
  const [url, setUrl] = useState(sourceProvider?.url ?? preset?.url ?? "");
  const [key, setKey] = useState(""); // 编辑时留空代表不更新
  const [providerType, setProviderType] = useState<ProviderType>(
    sourceProvider?.providerType ?? preset?.providerType ?? "claude"
  );
  const [preserveClientIp, setPreserveClientIp] = useState<boolean>(
    sourceProvider?.preserveClientIp ?? false
  );
  const [modelRedirects, setModelRedirects] = useState<Record<string, string>>(
    sourceProvider?.modelRedirects ?? {}
  );
  const [priority, setPriority] = useState<number>(sourceProvider?.priority ?? 0);
  const [weight, setWeight] = useState<number>(sourceProvider?.weight ?? 1);
  const [costMultiplier, setCostMultiplier] = useState<number>(
    sourceProvider?.costMultiplier ?? 1.0
  );
  const [groupTag, setGroupTag] = useState<string[]>(
    sourceProvider?.groupTag
      ? sourceProvider.groupTag
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : []
  );
  const [groupSuggestions, setGroupSuggestions] = useState<string[]>([]);
  const [limit5hUsd, setLimit5hUsd] = useState<number | null>(sourceProvider?.limit5hUsd ?? null);
  const [limitDailyUsd, setLimitDailyUsd] = useState<number | null>(
    sourceProvider?.limitDailyUsd ?? null
  );
  const [dailyResetMode, setDailyResetMode] = useState<"fixed" | "rolling">(
    sourceProvider?.dailyResetMode ?? "fixed"
  );
  const [dailyResetTime, setDailyResetTime] = useState<string>(
    sourceProvider?.dailyResetTime ?? "00:00"
  );
  const [limitWeeklyUsd, setLimitWeeklyUsd] = useState<number | null>(
    sourceProvider?.limitWeeklyUsd ?? null
  );
  const [limitMonthlyUsd, setLimitMonthlyUsd] = useState<number | null>(
    sourceProvider?.limitMonthlyUsd ?? null
  );
  const [limitTotalUsd, setLimitTotalUsd] = useState<number | null>(
    sourceProvider?.limitTotalUsd ?? null
  );
  const [limitConcurrentSessions, setLimitConcurrentSessions] = useState<number | null>(
    sourceProvider?.limitConcurrentSessions ?? null
  );
  const [allowedModels, setAllowedModels] = useState<string[]>(sourceProvider?.allowedModels ?? []);
  const [cacheTtlPreference, setCacheTtlPreference] = useState<"inherit" | "5m" | "1h">(
    sourceProvider?.cacheTtlPreference ?? "inherit"
  );

  // 1M Context Window 偏好配置（仅对 Anthropic 类型供应商有效）
  const [context1mPreference, setContext1mPreference] = useState<
    "inherit" | "force_enable" | "disabled"
  >((sourceProvider?.context1mPreference as "inherit" | "force_enable" | "disabled") ?? "inherit");

  // Codex（Responses API）供应商级参数覆写（仅对 Codex 类型供应商有效）
  const [codexReasoningEffortPreference, setCodexReasoningEffortPreference] =
    useState<CodexReasoningEffortPreference>(
      sourceProvider?.codexReasoningEffortPreference ?? "inherit"
    );
  const [codexReasoningSummaryPreference, setCodexReasoningSummaryPreference] =
    useState<CodexReasoningSummaryPreference>(
      sourceProvider?.codexReasoningSummaryPreference ?? "inherit"
    );
  const [codexTextVerbosityPreference, setCodexTextVerbosityPreference] =
    useState<CodexTextVerbosityPreference>(
      sourceProvider?.codexTextVerbosityPreference ?? "inherit"
    );
  const [codexParallelToolCallsPreference, setCodexParallelToolCallsPreference] =
    useState<CodexParallelToolCallsPreference>(
      sourceProvider?.codexParallelToolCallsPreference ?? "inherit"
    );

  // 熔断器配置（以分钟为单位显示，提交时转换为毫秒）
  // 允许 undefined，用户可以清空输入框，提交时使用默认值
  const [failureThreshold, setFailureThreshold] = useState<number | undefined>(
    sourceProvider?.circuitBreakerFailureThreshold
  );
  const [openDurationMinutes, setOpenDurationMinutes] = useState<number | undefined>(
    sourceProvider?.circuitBreakerOpenDuration
      ? sourceProvider.circuitBreakerOpenDuration / 60000
      : undefined
  );
  const [halfOpenSuccessThreshold, setHalfOpenSuccessThreshold] = useState<number | undefined>(
    sourceProvider?.circuitBreakerHalfOpenSuccessThreshold
  );
  const [maxRetryAttempts, setMaxRetryAttempts] = useState<number | null>(
    sourceProvider?.maxRetryAttempts ?? null
  );

  // 代理配置
  const [proxyUrl, setProxyUrl] = useState<string>(sourceProvider?.proxyUrl ?? "");
  const [proxyFallbackToDirect, setProxyFallbackToDirect] = useState<boolean>(
    sourceProvider?.proxyFallbackToDirect ?? false
  );

  // 超时配置（以秒为单位显示，提交时转换为毫秒）
  // ⚠️ 严格检查 null/undefined 并验证数值有效性，避免产生 NaN
  const [firstByteTimeoutStreamingSeconds, setFirstByteTimeoutStreamingSeconds] = useState<
    number | undefined
  >(() => {
    const ms = sourceProvider?.firstByteTimeoutStreamingMs;
    return ms != null && typeof ms === "number" && !Number.isNaN(ms) ? ms / 1000 : undefined;
  });
  const [streamingIdleTimeoutSeconds, setStreamingIdleTimeoutSeconds] = useState<
    number | undefined
  >(() => {
    const ms = sourceProvider?.streamingIdleTimeoutMs;
    return ms != null && typeof ms === "number" && !Number.isNaN(ms) ? ms / 1000 : undefined;
  });
  const [requestTimeoutNonStreamingSeconds, setRequestTimeoutNonStreamingSeconds] = useState<
    number | undefined
  >(() => {
    const ms = sourceProvider?.requestTimeoutNonStreamingMs;
    return ms != null && typeof ms === "number" && !Number.isNaN(ms) ? ms / 1000 : undefined;
  });

  // 供应商官网地址
  const [websiteUrl, setWebsiteUrl] = useState<string>(
    sourceProvider?.websiteUrl ?? preset?.websiteUrl ?? ""
  );
  const [autoUrlPending, setAutoUrlPending] = useState(false);

  useEffect(() => {
    if (isEdit) return;
    if (!hideUrl || !urlResolver) return;

    let cancelled = false;
    setAutoUrlPending(true);
    urlResolver(providerType)
      .then((resolved) => {
        if (cancelled) return;
        setUrl(resolved?.trim() ? resolved.trim() : "");
      })
      .catch(() => {
        if (cancelled) return;
        setUrl("");
      })
      .finally(() => {
        if (cancelled) return;
        setAutoUrlPending(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isEdit, hideUrl, urlResolver, providerType]);

  // MCP 透传配置
  const [mcpPassthroughType, setMcpPassthroughType] = useState<McpPassthroughType>(
    sourceProvider?.mcpPassthroughType ?? "none"
  );
  const [mcpPassthroughUrl, setMcpPassthroughUrl] = useState<string>(
    sourceProvider?.mcpPassthroughUrl || ""
  );

  // 折叠区域状态管理
  type SectionKey =
    | "routing"
    | "rateLimit"
    | "circuitBreaker"
    | "proxy"
    | "timeout"
    | "apiTest"
    | "mcpPassthrough";
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    routing: false,
    rateLimit: false,
    circuitBreaker: false,
    proxy: false,
    timeout: false,
    apiTest: false,
    mcpPassthrough: false,
  });

  // failureThreshold 确认对话框状态
  const [showFailureThresholdConfirm, setShowFailureThresholdConfirm] = useState(false);

  // 从 localStorage 加载折叠偏好
  useEffect(() => {
    const saved = localStorage.getItem("provider-form-sections");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setOpenSections((prev) => ({ ...prev, ...parsed }));
      } catch (e) {
        console.error("Failed to parse saved sections state:", e);
      }
    }
  }, []);

  // 保存折叠状态到 localStorage
  useEffect(() => {
    localStorage.setItem("provider-form-sections", JSON.stringify(openSections));
  }, [openSections]);

  // 自动聚焦名称输入框
  useEffect(() => {
    // 延迟聚焦，确保 Dialog 动画完成
    const timer = setTimeout(() => {
      nameInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Load existing provider groups as suggestions
  useEffect(() => {
    getDistinctProviderGroupsAction()
      .then((res) => {
        if (res.ok && res.data) {
          setGroupSuggestions(res.data);
        }
      })
      .catch((err) => {
        console.error("Failed to load provider groups:", err);
      });
  }, []);

  // 折叠区域切换函数
  const toggleSection = (key: SectionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // 展开全部高级配置
  const expandAll = () => {
    setOpenSections({
      routing: true,
      rateLimit: true,
      circuitBreaker: true,
      proxy: true,
      timeout: true,
      apiTest: true,
      mcpPassthrough: true,
    });
  };

  // 折叠全部高级配置
  const collapseAll = () => {
    setOpenSections({
      routing: false,
      rateLimit: false,
      circuitBreaker: false,
      proxy: false,
      timeout: false,
      apiTest: false,
      mcpPassthrough: false,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || (!isEdit && !key.trim())) {
      return;
    }

    if (!url.trim()) {
      if (hideUrl) {
        toast.error(tProviders("noEndpoints"));
      }
      return;
    }

    if (!isValidUrl(url.trim())) {
      toast.error(t("errors.invalidUrl"));
      return;
    }

    // 验证 websiteUrl（可选，但如果填写了必须是有效 URL）
    if (websiteUrl.trim() && !isValidUrl(websiteUrl.trim())) {
      toast.error(t("errors.invalidWebsiteUrl"));
      return;
    }

    // group_tag 在 DB/schema 中限制为 varchar(50)，并且后端按整串校验 max(50)
    // 这里限制逗号拼接后的总长度，避免"UI 看似可选多标签，但保存必失败"的体验
    const serializedGroupTag = groupTag.join(",");
    if (serializedGroupTag.length > GROUP_TAG_MAX_TOTAL_LENGTH) {
      toast.error(t("errors.groupTagTooLong", { max: GROUP_TAG_MAX_TOTAL_LENGTH }));
      return;
    }

    // 检查 failureThreshold 是否为特殊值（0 或大于 100）
    const threshold = failureThreshold ?? 5;
    if (threshold === 0 || threshold > 100) {
      setShowFailureThresholdConfirm(true);
      return;
    }

    // 正常提交
    performSubmit();
  };

  const handleGroupTagChange = (nextTags: string[]) => {
    const serialized = nextTags.join(",");
    if (serialized.length > GROUP_TAG_MAX_TOTAL_LENGTH) {
      toast.error(t("errors.groupTagTooLong", { max: GROUP_TAG_MAX_TOTAL_LENGTH }));
      return;
    }
    setGroupTag(nextTags);
  };

  // 实际提交逻辑
  const performSubmit = () => {
    // 处理模型重定向（空对象转为 null）
    const parsedModelRedirects = Object.keys(modelRedirects).length > 0 ? modelRedirects : null;

    startTransition(async () => {
      try {
        if (isEdit && provider) {
          const updateData: {
            name?: string;
            url?: string;
            key?: string;
            provider_type?: ProviderType;
            model_redirects?: Record<string, string> | null;
            allowed_models?: string[] | null;
            priority?: number;
            weight?: number;
            cost_multiplier?: number;
            group_tag?: string | null;
            limit_5h_usd?: number | null;
            limit_daily_usd?: number | null;
            daily_reset_mode?: "fixed" | "rolling";
            daily_reset_time?: string;
            limit_weekly_usd?: number | null;
            limit_monthly_usd?: number | null;
            limit_total_usd?: number | null;
            limit_concurrent_sessions?: number | null;
            cache_ttl_preference?: "inherit" | "5m" | "1h";
            context_1m_preference?: Context1mPreference | null;
            codex_reasoning_effort_preference?: CodexReasoningEffortPreference | null;
            codex_reasoning_summary_preference?: CodexReasoningSummaryPreference | null;
            codex_text_verbosity_preference?: CodexTextVerbosityPreference | null;
            codex_parallel_tool_calls_preference?: CodexParallelToolCallsPreference | null;
            max_retry_attempts?: number | null;
            circuit_breaker_failure_threshold?: number;
            circuit_breaker_open_duration?: number;
            circuit_breaker_half_open_success_threshold?: number;
            proxy_url?: string | null;
            proxy_fallback_to_direct?: boolean;
            first_byte_timeout_streaming_ms?: number;
            streaming_idle_timeout_ms?: number;
            request_timeout_non_streaming_ms?: number;
            website_url?: string | null;
            mcp_passthrough_type?: McpPassthroughType;
            mcp_passthrough_url?: string | null;
            preserve_client_ip?: boolean;
            tpm?: number | null;
            rpm?: number | null;
            rpd?: number | null;
            cc?: number | null;
          } = {
            name: name.trim(),
            url: url.trim(),
            provider_type: providerType,
            preserve_client_ip: preserveClientIp,
            model_redirects: parsedModelRedirects,
            allowed_models: allowedModels.length > 0 ? allowedModels : null,
            priority: priority,
            weight: weight,
            cost_multiplier: costMultiplier,
            group_tag: groupTag.length > 0 ? groupTag.join(",") : null,
            limit_5h_usd: limit5hUsd,
            limit_daily_usd: limitDailyUsd,
            daily_reset_mode: dailyResetMode,
            daily_reset_time: dailyResetTime,
            limit_weekly_usd: limitWeeklyUsd,
            limit_monthly_usd: limitMonthlyUsd,
            limit_total_usd: limitTotalUsd,
            limit_concurrent_sessions: limitConcurrentSessions ?? 0,
            cache_ttl_preference: cacheTtlPreference,
            context_1m_preference: context1mPreference,
            codex_reasoning_effort_preference: codexReasoningEffortPreference,
            codex_reasoning_summary_preference: codexReasoningSummaryPreference,
            codex_text_verbosity_preference: codexTextVerbosityPreference,
            codex_parallel_tool_calls_preference: codexParallelToolCallsPreference,
            max_retry_attempts: maxRetryAttempts,
            circuit_breaker_failure_threshold: failureThreshold ?? 5,
            circuit_breaker_open_duration: openDurationMinutes
              ? openDurationMinutes * 60000
              : 1800000,
            circuit_breaker_half_open_success_threshold: halfOpenSuccessThreshold ?? 2,
            proxy_url: proxyUrl.trim() || null,
            proxy_fallback_to_direct: proxyFallbackToDirect,
            first_byte_timeout_streaming_ms:
              firstByteTimeoutStreamingSeconds != null
                ? firstByteTimeoutStreamingSeconds * 1000
                : undefined,
            streaming_idle_timeout_ms:
              streamingIdleTimeoutSeconds != null ? streamingIdleTimeoutSeconds * 1000 : undefined,
            request_timeout_non_streaming_ms:
              requestTimeoutNonStreamingSeconds != null
                ? requestTimeoutNonStreamingSeconds * 1000
                : undefined,
            website_url: websiteUrl.trim() || null,
            mcp_passthrough_type: mcpPassthroughType,
            mcp_passthrough_url: mcpPassthroughUrl.trim() || null,
            tpm: null,
            rpm: null,
            rpd: null,
            cc: null,
          };
          if (key.trim()) {
            updateData.key = key.trim();
          }
          const res = await editProvider(provider.id, updateData);
          if (!res.ok) {
            toast.error(res.error || t("errors.updateFailed"));
            return;
          }
        } else {
          const res = await addProvider({
            name: name.trim(),
            url: url.trim(),
            key: key.trim(),
            provider_type: providerType,
            preserve_client_ip: preserveClientIp,
            model_redirects: parsedModelRedirects,
            allowed_models: allowedModels.length > 0 ? allowedModels : null,
            // 使用配置的默认值：默认不启用、权重=1
            is_enabled: PROVIDER_DEFAULTS.IS_ENABLED,
            weight: weight,
            priority: priority,
            cost_multiplier: costMultiplier,
            group_tag: groupTag.length > 0 ? groupTag.join(",") : null,
            limit_5h_usd: limit5hUsd,
            limit_daily_usd: limitDailyUsd,
            daily_reset_mode: dailyResetMode,
            daily_reset_time: dailyResetTime,
            limit_weekly_usd: limitWeeklyUsd,
            limit_monthly_usd: limitMonthlyUsd,
            limit_total_usd: limitTotalUsd,
            limit_concurrent_sessions: limitConcurrentSessions ?? 0,
            cache_ttl_preference: cacheTtlPreference,
            context_1m_preference: context1mPreference,
            codex_reasoning_effort_preference: codexReasoningEffortPreference,
            codex_reasoning_summary_preference: codexReasoningSummaryPreference,
            codex_text_verbosity_preference: codexTextVerbosityPreference,
            codex_parallel_tool_calls_preference: codexParallelToolCallsPreference,
            max_retry_attempts: maxRetryAttempts,
            circuit_breaker_failure_threshold: failureThreshold ?? 5,
            circuit_breaker_open_duration: openDurationMinutes
              ? openDurationMinutes * 60000
              : 1800000,
            circuit_breaker_half_open_success_threshold: halfOpenSuccessThreshold ?? 2,
            proxy_url: proxyUrl.trim() || null,
            proxy_fallback_to_direct: proxyFallbackToDirect,
            first_byte_timeout_streaming_ms:
              firstByteTimeoutStreamingSeconds != null
                ? firstByteTimeoutStreamingSeconds * 1000
                : PROVIDER_TIMEOUT_DEFAULTS.FIRST_BYTE_TIMEOUT_STREAMING_MS,
            streaming_idle_timeout_ms:
              streamingIdleTimeoutSeconds != null
                ? streamingIdleTimeoutSeconds * 1000
                : PROVIDER_TIMEOUT_DEFAULTS.STREAMING_IDLE_TIMEOUT_MS,
            request_timeout_non_streaming_ms:
              requestTimeoutNonStreamingSeconds != null
                ? requestTimeoutNonStreamingSeconds * 1000
                : PROVIDER_TIMEOUT_DEFAULTS.REQUEST_TIMEOUT_NON_STREAMING_MS,
            website_url: websiteUrl.trim() || null,
            mcp_passthrough_type: mcpPassthroughType,
            mcp_passthrough_url: mcpPassthroughUrl.trim() || null,
            tpm: null,
            rpm: null,
            rpd: null,
            cc: null,
          });
          if (!res.ok) {
            toast.error(res.error || t("errors.addFailed"));
            return;
          }
          // 添加成功提示
          toast.success(t("success.created"), {
            description: t("success.createdDesc", { name: name.trim() }),
          });
          // 重置表单（仅新增）
          setName("");
          setUrl("");
          setKey("");
          setProviderType("claude");
          setPreserveClientIp(false);
          setModelRedirects({});
          setAllowedModels([]);
          setPriority(0);
          setWeight(1);
          setCostMultiplier(1.0);
          setGroupTag([]);
          setLimit5hUsd(null);
          setLimitDailyUsd(null);
          setDailyResetTime("00:00");
          setLimitWeeklyUsd(null);
          setLimitMonthlyUsd(null);
          setLimitTotalUsd(null);
          setLimitConcurrentSessions(null);
          setMaxRetryAttempts(null);
          setFailureThreshold(5);
          setOpenDurationMinutes(30);
          setHalfOpenSuccessThreshold(2);
          setProxyUrl("");
          setProxyFallbackToDirect(false);
          setFirstByteTimeoutStreamingSeconds(
            PROVIDER_TIMEOUT_DEFAULTS.FIRST_BYTE_TIMEOUT_STREAMING_MS / 1000
          );
          // ⭐ 修复遗漏：重置流式静默期超时
          setStreamingIdleTimeoutSeconds(
            PROVIDER_TIMEOUT_DEFAULTS.STREAMING_IDLE_TIMEOUT_MS / 1000
          );
          setRequestTimeoutNonStreamingSeconds(
            PROVIDER_TIMEOUT_DEFAULTS.REQUEST_TIMEOUT_NON_STREAMING_MS / 1000
          );
          setWebsiteUrl("");
          setContext1mPreference("inherit");
        }
        onSuccess?.();
      } catch (error) {
        console.error(isEdit ? t("errors.updateFailed") : t("errors.addFailed"), error);
        toast.error(isEdit ? t("errors.updateFailed") : t("errors.addFailed"));
      }
    });
  };

  return (
    <TooltipProvider>
      <DialogHeader className="flex-shrink-0">
        <DialogTitle>{isEdit ? t("title.edit") : t("title.create")}</DialogTitle>
        <DialogDescription className="sr-only">{t("dialogDescription")}</DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <div className="space-y-4 overflow-y-auto pr-2 flex-1">
          <div className="space-y-2">
            <Label htmlFor={isEdit ? "edit-name" : "name"}>{t("name.label")}</Label>
            <Input
              ref={nameInputRef}
              id={isEdit ? "edit-name" : "name"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("name.placeholder")}
              disabled={isPending}
              required
            />
          </div>

          {/* 移除描述字段 */}

          {!hideUrl ? (
            <div className="space-y-2">
              <Label htmlFor={isEdit ? "edit-url" : "url"}>{t("url.label")}</Label>
              <Input
                id={isEdit ? "edit-url" : "url"}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t("url.placeholder")}
                disabled={isPending}
                required
              />
              {url.trim() && <UrlPreview baseUrl={url} providerType={providerType} />}
            </div>
          ) : null}

          {hideUrl && !isEdit && !autoUrlPending && !url.trim() ? (
            <div className="rounded-md border border-dashed p-3">
              <div className="text-sm font-medium">{tProviders("noEndpoints")}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {tProviders("noEndpointsDesc")}
              </div>
            </div>
          ) : null}

          {hideUrl && !isEdit && autoUrlPending ? (
            <div className="text-xs text-muted-foreground">{tProviders("keyLoading")}</div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor={isEdit ? "edit-key" : "key"}>
              {t("key.label")}
              {isEdit ? t("key.leaveEmpty") : ""}
            </Label>
            <Input
              id={isEdit ? "edit-key" : "key"}
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={isEdit ? t("key.leaveEmptyDesc") : t("key.placeholder")}
              disabled={isPending}
              required={!isEdit}
            />
            {isEdit && provider ? (
              <div className="text-xs text-muted-foreground">
                {t("key.currentKey", { key: provider.maskedKey })}
              </div>
            ) : null}
          </div>

          {!hideWebsiteUrl ? (
            <div className="space-y-2">
              <Label htmlFor={isEdit ? "edit-website-url" : "website-url"}>
                {t("websiteUrl.label")}
              </Label>
              <Input
                id={isEdit ? "edit-website-url" : "website-url"}
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder={t("websiteUrl.placeholder")}
                disabled={isPending}
              />
              <div className="text-xs text-muted-foreground">{t("websiteUrl.desc")}</div>
            </div>
          ) : null}

          {/* 展开/折叠全部按钮 */}
          <div className="flex gap-2 py-2 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={expandAll}
              disabled={isPending}
            >
              {t("buttons.expandAll")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={collapseAll}
              disabled={isPending}
            >
              {t("buttons.collapseAll")}
            </Button>
          </div>

          {/* Codex 支持：供应商类型和模型重定向 */}
          <Collapsible open={openSections.routing} onOpenChange={() => toggleSection("routing")}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center justify-between w-full py-4 border-t hover:bg-muted/50 transition-colors cursor-pointer"
                disabled={isPending}
              >
                <div className="flex items-center gap-2">
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      openSections.routing ? "rotate-180" : ""
                    }`}
                  />
                  <span className="text-sm font-medium">{t("sections.routing.title")}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {(() => {
                    const parts = [];
                    if (allowedModels.length > 0)
                      parts.push(
                        t("sections.routing.summary.models", {
                          count: allowedModels.length,
                        })
                      );
                    if (Object.keys(modelRedirects).length > 0)
                      parts.push(
                        t("sections.routing.summary.redirects", {
                          count: Object.keys(modelRedirects).length,
                        })
                      );
                    return parts.length > 0 ? parts.join(", ") : t("sections.routing.summary.none");
                  })()}
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pb-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor={isEdit ? "edit-provider-type" : "provider-type"}>
                    {t("sections.routing.providerType.label")}
                    <span className="text-xs text-muted-foreground ml-1">
                      {t("sections.routing.providerType.desc")}
                    </span>
                  </Label>
                  <Select
                    value={providerType}
                    onValueChange={(value) => setProviderType(value as ProviderType)}
                    disabled={isPending}
                  >
                    <SelectTrigger id={isEdit ? "edit-provider-type" : "provider-type"}>
                      <SelectValue placeholder={t("sections.routing.providerType.placeholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        allowedProviderTypes ?? [
                          "claude",
                          "claude-auth",
                          "codex",
                          "gemini",
                          "gemini-cli",
                          "openai-compatible",
                        ]
                      ).map((type) => {
                        const typeConfig = getProviderTypeConfig(type);
                        const TypeIcon = typeConfig.icon;
                        const label = renderProviderTypeLabel(type);
                        const disabled =
                          type === "openai-compatible" ? !enableMultiProviderTypes : false;
                        return (
                          <SelectItem key={type} value={type} disabled={disabled}>
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-flex h-5 w-5 items-center justify-center rounded ${typeConfig.bgColor}`}
                              >
                                <TypeIcon className={`h-3.5 w-3.5 ${typeConfig.iconColor}`} />
                              </span>
                              <span>{label}</span>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t("sections.routing.providerTypeDesc")}
                    {!enableMultiProviderTypes && (
                      <span className="text-amber-600 ml-1">
                        {t("sections.routing.providerTypeDisabledNote")}
                      </span>
                    )}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={isEdit ? "edit-group" : "group"}>
                    {t("sections.routing.scheduleParams.group.label")}
                  </Label>
                  <TagInput
                    id={isEdit ? "edit-group" : "group"}
                    value={groupTag}
                    onChange={handleGroupTagChange}
                    placeholder={t("sections.routing.scheduleParams.group.placeholder")}
                    disabled={isPending}
                    maxTagLength={GROUP_TAG_MAX_TOTAL_LENGTH}
                    suggestions={groupSuggestions}
                    onInvalidTag={(_tag, reason) => {
                      const messages: Record<string, string> = {
                        empty: tUI("emptyTag"),
                        duplicate: tUI("duplicateTag"),
                        too_long: tUI("tooLong", { max: GROUP_TAG_MAX_TOTAL_LENGTH }),
                        invalid_format: tUI("invalidFormat"),
                        max_tags: tUI("maxTags"),
                      };
                      toast.error(messages[reason] || reason);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("sections.routing.scheduleParams.group.desc")}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor={isEdit ? "edit-preserve-client-ip" : "preserve-client-ip"}>
                        {t("sections.routing.preserveClientIp.label")}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {t("sections.routing.preserveClientIp.desc")}
                      </p>
                    </div>
                    <Switch
                      id={isEdit ? "edit-preserve-client-ip" : "preserve-client-ip"}
                      checked={preserveClientIp}
                      onCheckedChange={setPreserveClientIp}
                      disabled={isPending}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("sections.routing.preserveClientIp.help")}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>
                    {t("sections.routing.modelRedirects.label")}
                    <span className="text-xs text-muted-foreground ml-1">
                      {t("sections.routing.modelRedirects.optional")}
                    </span>
                  </Label>
                  <ModelRedirectEditor
                    value={modelRedirects}
                    onChange={setModelRedirects}
                    disabled={isPending}
                  />
                </div>

                {/* 模型白名单配置 */}
                <div className="space-y-1">
                  <div className="text-sm font-medium">
                    {t("sections.routing.modelWhitelist.title")}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("sections.routing.modelWhitelist.desc")}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="allowed-models">
                    {t("sections.routing.modelWhitelist.label")}
                    <span className="text-xs text-muted-foreground ml-1">
                      {t("sections.routing.modelWhitelist.optional")}
                    </span>
                  </Label>

                  <ModelMultiSelect
                    providerType={
                      providerType as
                        | "claude"
                        | "claude-auth"
                        | "codex"
                        | "gemini"
                        | "gemini-cli"
                        | "openai-compatible"
                    }
                    selectedModels={allowedModels}
                    onChange={setAllowedModels}
                    disabled={isPending}
                    providerUrl={url}
                    apiKey={key}
                    proxyUrl={proxyUrl}
                    proxyFallbackToDirect={proxyFallbackToDirect}
                    providerId={isEdit ? provider?.id : undefined}
                  />

                  {allowedModels.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2 p-2 bg-muted/50 rounded-md">
                      {allowedModels.slice(0, 5).map((model) => (
                        <Badge key={model} variant="outline" className="font-mono text-xs">
                          {model}
                        </Badge>
                      ))}
                      {allowedModels.length > 5 && (
                        <Badge variant="secondary" className="text-xs">
                          {t("sections.routing.modelWhitelist.moreModels", {
                            count: allowedModels.length - 5,
                          })}
                        </Badge>
                      )}
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    {allowedModels.length === 0 ? (
                      <span className="text-green-600">
                        {t("sections.routing.modelWhitelist.allowAll")}
                      </span>
                    ) : (
                      <span>
                        {t("sections.routing.modelWhitelist.selectedOnly", {
                          count: allowedModels.length,
                        })}
                      </span>
                    )}
                  </p>
                </div>

                {/* 路由配置 - 优先级、权重、成本 */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor={isEdit ? "edit-priority" : "priority"}>
                      {t("sections.routing.scheduleParams.priority.label")}
                    </Label>
                    <Input
                      id={isEdit ? "edit-priority" : "priority"}
                      type="number"
                      value={priority}
                      onChange={(e) => setPriority(parseInt(e.target.value, 10) || 0)}
                      placeholder={t("sections.routing.scheduleParams.priority.placeholder")}
                      disabled={isPending}
                      min="0"
                      step="1"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("sections.routing.scheduleParams.priority.desc")}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={isEdit ? "edit-weight" : "weight"}>
                      {t("sections.routing.scheduleParams.weight.label")}
                    </Label>
                    <Input
                      id={isEdit ? "edit-weight" : "weight"}
                      type="number"
                      value={weight}
                      onChange={(e) => setWeight(parseInt(e.target.value, 10) || 1)}
                      placeholder={t("sections.routing.scheduleParams.weight.placeholder")}
                      disabled={isPending}
                      min="1"
                      step="1"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("sections.routing.scheduleParams.weight.desc")}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={isEdit ? "edit-cost" : "cost"}>
                      {t("sections.routing.scheduleParams.costMultiplier.label")}
                    </Label>
                    <Input
                      id={isEdit ? "edit-cost" : "cost"}
                      type="number"
                      value={costMultiplier}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === "") {
                          setCostMultiplier(1.0);
                          return;
                        }
                        const num = parseFloat(value);
                        setCostMultiplier(Number.isNaN(num) ? 1.0 : num);
                      }}
                      onFocus={(e) => e.target.select()}
                      placeholder={t("sections.routing.scheduleParams.costMultiplier.placeholder")}
                      disabled={isPending}
                      min="0"
                      step="0.0001"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("sections.routing.scheduleParams.costMultiplier.desc")}
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("sections.routing.cacheTtl.label")}</Label>
                  <Select
                    value={cacheTtlPreference}
                    onValueChange={(val) => setCacheTtlPreference(val as "inherit" | "5m" | "1h")}
                    disabled={isPending}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="inherit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">
                        {t("sections.routing.cacheTtl.options.inherit")}
                      </SelectItem>
                      <SelectItem value="5m">
                        {t("sections.routing.cacheTtl.options.5m")}
                      </SelectItem>
                      <SelectItem value="1h">
                        {t("sections.routing.cacheTtl.options.1h")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t("sections.routing.cacheTtl.desc")}
                  </p>
                </div>

                {/* 1M Context Window 配置 - 仅 Anthropic 类型供应商显示 */}
                {(providerType === "claude" || providerType === "claude-auth") && (
                  <div className="space-y-2">
                    <Label>{t("sections.routing.context1m.label")}</Label>
                    <Select
                      value={context1mPreference}
                      onValueChange={(val) =>
                        setContext1mPreference(val as "inherit" | "force_enable" | "disabled")
                      }
                      disabled={isPending}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="inherit" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">
                          {t("sections.routing.context1m.options.inherit")}
                        </SelectItem>
                        <SelectItem value="force_enable">
                          {t("sections.routing.context1m.options.forceEnable")}
                        </SelectItem>
                        <SelectItem value="disabled">
                          {t("sections.routing.context1m.options.disabled")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {t("sections.routing.context1m.desc")}
                    </p>
                  </div>
                )}

                {/* Codex 参数覆写 - 仅 Codex 类型供应商显示 */}
                {providerType === "codex" && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <FieldLabelWithTooltip
                        label={t("sections.routing.codexOverrides.reasoningEffort.label")}
                        tooltip={t("sections.routing.codexOverrides.reasoningEffort.help")}
                      />
                      <Select
                        value={codexReasoningEffortPreference}
                        onValueChange={(val) =>
                          setCodexReasoningEffortPreference(val as CodexReasoningEffortPreference)
                        }
                        disabled={isPending}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="inherit" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">
                            {t("sections.routing.codexOverrides.reasoningEffort.options.inherit")}
                          </SelectItem>
                          <SelectItem value="minimal">
                            {t("sections.routing.codexOverrides.reasoningEffort.options.minimal")}
                          </SelectItem>
                          <SelectItem value="low">
                            {t("sections.routing.codexOverrides.reasoningEffort.options.low")}
                          </SelectItem>
                          <SelectItem value="medium">
                            {t("sections.routing.codexOverrides.reasoningEffort.options.medium")}
                          </SelectItem>
                          <SelectItem value="high">
                            {t("sections.routing.codexOverrides.reasoningEffort.options.high")}
                          </SelectItem>
                          <SelectItem value="xhigh">
                            {t("sections.routing.codexOverrides.reasoningEffort.options.xhigh")}
                          </SelectItem>
                          <SelectItem value="none">
                            {t("sections.routing.codexOverrides.reasoningEffort.options.none")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <FieldLabelWithTooltip
                        label={t("sections.routing.codexOverrides.reasoningSummary.label")}
                        tooltip={t("sections.routing.codexOverrides.reasoningSummary.help")}
                      />
                      <Select
                        value={codexReasoningSummaryPreference}
                        onValueChange={(val) =>
                          setCodexReasoningSummaryPreference(val as CodexReasoningSummaryPreference)
                        }
                        disabled={isPending}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="inherit" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">
                            {t("sections.routing.codexOverrides.reasoningSummary.options.inherit")}
                          </SelectItem>
                          <SelectItem value="auto">
                            {t("sections.routing.codexOverrides.reasoningSummary.options.auto")}
                          </SelectItem>
                          <SelectItem value="detailed">
                            {t("sections.routing.codexOverrides.reasoningSummary.options.detailed")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <FieldLabelWithTooltip
                        label={t("sections.routing.codexOverrides.textVerbosity.label")}
                        tooltip={t("sections.routing.codexOverrides.textVerbosity.help")}
                      />
                      <Select
                        value={codexTextVerbosityPreference}
                        onValueChange={(val) =>
                          setCodexTextVerbosityPreference(val as CodexTextVerbosityPreference)
                        }
                        disabled={isPending}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="inherit" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">
                            {t("sections.routing.codexOverrides.textVerbosity.options.inherit")}
                          </SelectItem>
                          <SelectItem value="low">
                            {t("sections.routing.codexOverrides.textVerbosity.options.low")}
                          </SelectItem>
                          <SelectItem value="medium">
                            {t("sections.routing.codexOverrides.textVerbosity.options.medium")}
                          </SelectItem>
                          <SelectItem value="high">
                            {t("sections.routing.codexOverrides.textVerbosity.options.high")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <FieldLabelWithTooltip
                        label={t("sections.routing.codexOverrides.parallelToolCalls.label")}
                        tooltip={t("sections.routing.codexOverrides.parallelToolCalls.help")}
                      />
                      <Select
                        value={codexParallelToolCallsPreference}
                        onValueChange={(val) =>
                          setCodexParallelToolCallsPreference(
                            val as CodexParallelToolCallsPreference
                          )
                        }
                        disabled={isPending}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="inherit" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">
                            {t("sections.routing.codexOverrides.parallelToolCalls.options.inherit")}
                          </SelectItem>
                          <SelectItem value="true">
                            {t("sections.routing.codexOverrides.parallelToolCalls.options.true")}
                          </SelectItem>
                          <SelectItem value="false">
                            {t("sections.routing.codexOverrides.parallelToolCalls.options.false")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* 限流配置 */}
          <Collapsible
            open={openSections.rateLimit}
            onOpenChange={() => toggleSection("rateLimit")}
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center justify-between w-full py-4 border-t hover:bg-muted/50 transition-colors cursor-pointer"
                disabled={isPending}
              >
                <div className="flex items-center gap-2">
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      openSections.rateLimit ? "rotate-180" : ""
                    }`}
                  />
                  <span className="text-sm font-medium">{t("sections.rateLimit.title")}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {(() => {
                    const limits: string[] = [];
                    if (limit5hUsd)
                      limits.push(
                        t("sections.rateLimit.summary.fiveHour", {
                          amount: limit5hUsd,
                        })
                      );
                    if (limitDailyUsd)
                      limits.push(
                        t("sections.rateLimit.summary.daily", {
                          amount: limitDailyUsd,
                          resetTime: dailyResetTime,
                        })
                      );
                    if (limitWeeklyUsd)
                      limits.push(
                        t("sections.rateLimit.summary.weekly", {
                          amount: limitWeeklyUsd,
                        })
                      );
                    if (limitMonthlyUsd)
                      limits.push(
                        t("sections.rateLimit.summary.monthly", {
                          amount: limitMonthlyUsd,
                        })
                      );
                    if (limitTotalUsd)
                      limits.push(
                        t("sections.rateLimit.summary.total", {
                          amount: limitTotalUsd,
                        })
                      );
                    if (limitConcurrentSessions)
                      limits.push(
                        t("sections.rateLimit.summary.concurrent", {
                          count: limitConcurrentSessions,
                        })
                      );
                    return limits.length > 0
                      ? limits.join(", ")
                      : t("sections.rateLimit.summary.none");
                  })()}
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pb-4">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor={isEdit ? "edit-limit-5h" : "limit-5h"}>
                      {t("sections.rateLimit.limit5h.label")}
                    </Label>
                    <Input
                      id={isEdit ? "edit-limit-5h" : "limit-5h"}
                      type="number"
                      value={limit5hUsd?.toString() ?? ""}
                      onChange={(e) => setLimit5hUsd(validatePositiveDecimalField(e.target.value))}
                      placeholder={t("sections.rateLimit.limit5h.placeholder")}
                      disabled={isPending}
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={isEdit ? "edit-limit-daily" : "limit-daily"}>
                      {t("sections.rateLimit.limitDaily.label")}
                    </Label>
                    <Input
                      id={isEdit ? "edit-limit-daily" : "limit-daily"}
                      type="number"
                      value={limitDailyUsd?.toString() ?? ""}
                      onChange={(e) =>
                        setLimitDailyUsd(validatePositiveDecimalField(e.target.value))
                      }
                      placeholder={t("sections.rateLimit.limitDaily.placeholder")}
                      disabled={isPending}
                      min="0"
                      step="0.01"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor={isEdit ? "edit-daily-reset-mode" : "daily-reset-mode"}>
                      {t("sections.rateLimit.dailyResetMode.label")}
                    </Label>
                    <Select
                      value={dailyResetMode}
                      onValueChange={(value: "fixed" | "rolling") => setDailyResetMode(value)}
                      disabled={isPending}
                    >
                      <SelectTrigger id={isEdit ? "edit-daily-reset-mode" : "daily-reset-mode"}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">
                          {t("sections.rateLimit.dailyResetMode.options.fixed")}
                        </SelectItem>
                        <SelectItem value="rolling">
                          {t("sections.rateLimit.dailyResetMode.options.rolling")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {dailyResetMode === "fixed"
                        ? t("sections.rateLimit.dailyResetMode.desc.fixed")
                        : t("sections.rateLimit.dailyResetMode.desc.rolling")}
                    </p>
                  </div>
                  {dailyResetMode === "fixed" && (
                    <div className="space-y-2">
                      <Label htmlFor={isEdit ? "edit-daily-reset" : "daily-reset"}>
                        {t("sections.rateLimit.dailyResetTime.label")}
                      </Label>
                      <Input
                        id={isEdit ? "edit-daily-reset" : "daily-reset"}
                        type="time"
                        value={dailyResetTime}
                        onChange={(e) => setDailyResetTime(e.target.value || "00:00")}
                        placeholder="00:00"
                        disabled={isPending}
                        step="60"
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor={isEdit ? "edit-limit-weekly" : "limit-weekly"}>
                      {t("sections.rateLimit.limitWeekly.label")}
                    </Label>
                    <Input
                      id={isEdit ? "edit-limit-weekly" : "limit-weekly"}
                      type="number"
                      value={limitWeeklyUsd?.toString() ?? ""}
                      onChange={(e) =>
                        setLimitWeeklyUsd(validatePositiveDecimalField(e.target.value))
                      }
                      placeholder={t("sections.rateLimit.limitWeekly.placeholder")}
                      disabled={isPending}
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={isEdit ? "edit-limit-total" : "limit-total"}>
                      {t("sections.rateLimit.limitTotal.label")}
                    </Label>
                    <Input
                      id={isEdit ? "edit-limit-total" : "limit-total"}
                      type="number"
                      value={limitTotalUsd?.toString() ?? ""}
                      onChange={(e) =>
                        setLimitTotalUsd(validatePositiveDecimalField(e.target.value))
                      }
                      placeholder={t("sections.rateLimit.limitTotal.placeholder")}
                      disabled={isPending}
                      min="0"
                      step="0.01"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor={isEdit ? "edit-limit-monthly" : "limit-monthly"}>
                      {t("sections.rateLimit.limitMonthly.label")}
                    </Label>
                    <Input
                      id={isEdit ? "edit-limit-monthly" : "limit-monthly"}
                      type="number"
                      value={limitMonthlyUsd?.toString() ?? ""}
                      onChange={(e) =>
                        setLimitMonthlyUsd(validatePositiveDecimalField(e.target.value))
                      }
                      placeholder={t("sections.rateLimit.limitMonthly.placeholder")}
                      disabled={isPending}
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={isEdit ? "edit-limit-concurrent" : "limit-concurrent"}>
                      {t("sections.rateLimit.limitConcurrent.label")}
                    </Label>
                    <Input
                      id={isEdit ? "edit-limit-concurrent" : "limit-concurrent"}
                      type="number"
                      value={limitConcurrentSessions?.toString() ?? ""}
                      onChange={(e) =>
                        setLimitConcurrentSessions(validateNumericField(e.target.value))
                      }
                      placeholder={t("sections.rateLimit.limitConcurrent.placeholder")}
                      disabled={isPending}
                      min="0"
                      step="1"
                    />
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* 熔断器配置 */}
          <Collapsible
            open={openSections.circuitBreaker}
            onOpenChange={() => toggleSection("circuitBreaker")}
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center justify-between w-full py-4 border-t hover:bg-muted/50 transition-colors cursor-pointer"
                disabled={isPending}
              >
                <div className="flex items-center gap-2">
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      openSections.circuitBreaker ? "rotate-180" : ""
                    }`}
                  />
                  <span className="text-sm font-medium">{t("sections.circuitBreaker.title")}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t("sections.circuitBreaker.summary", {
                    failureThreshold: failureThreshold ?? 5,
                    openDuration: openDurationMinutes ?? 30,
                    successThreshold: halfOpenSuccessThreshold ?? 2,
                    maxRetryAttempts: maxRetryAttempts ?? PROVIDER_DEFAULTS.MAX_RETRY_ATTEMPTS,
                  })}
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pb-4">
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {t("sections.circuitBreaker.desc")}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor={isEdit ? "edit-failure-threshold" : "failure-threshold"}>
                      {t("sections.circuitBreaker.failureThreshold.label")}
                    </Label>
                    <Input
                      id={isEdit ? "edit-failure-threshold" : "failure-threshold"}
                      type="number"
                      value={failureThreshold ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFailureThreshold(val === "" ? undefined : parseInt(val, 10));
                      }}
                      placeholder={t("sections.circuitBreaker.failureThreshold.placeholder")}
                      disabled={isPending}
                      min="0"
                      step="1"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("sections.circuitBreaker.failureThreshold.desc")}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={isEdit ? "edit-open-duration" : "open-duration"}>
                      {t("sections.circuitBreaker.openDuration.label")}
                    </Label>
                    <Input
                      id={isEdit ? "edit-open-duration" : "open-duration"}
                      type="number"
                      value={openDurationMinutes ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setOpenDurationMinutes(val === "" ? undefined : parseInt(val, 10));
                      }}
                      placeholder={t("sections.circuitBreaker.openDuration.placeholder")}
                      disabled={isPending}
                      min="1"
                      max="1440"
                      step="1"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("sections.circuitBreaker.openDuration.desc")}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={isEdit ? "edit-success-threshold" : "success-threshold"}>
                      {t("sections.circuitBreaker.successThreshold.label")}
                    </Label>
                    <Input
                      id={isEdit ? "edit-success-threshold" : "success-threshold"}
                      type="number"
                      value={halfOpenSuccessThreshold ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setHalfOpenSuccessThreshold(val === "" ? undefined : parseInt(val, 10));
                      }}
                      placeholder={t("sections.circuitBreaker.successThreshold.placeholder")}
                      disabled={isPending}
                      min="1"
                      max="10"
                      step="1"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("sections.circuitBreaker.successThreshold.desc")}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={isEdit ? "edit-max-retry-attempts" : "max-retry-attempts"}>
                      {t("sections.circuitBreaker.maxRetryAttempts.label")}
                    </Label>
                    <Input
                      id={isEdit ? "edit-max-retry-attempts" : "max-retry-attempts"}
                      type="number"
                      value={maxRetryAttempts ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setMaxRetryAttempts(val === "" ? null : parseInt(val, 10));
                      }}
                      placeholder={t("sections.circuitBreaker.maxRetryAttempts.placeholder")}
                      disabled={isPending}
                      min="1"
                      max="10"
                      step="1"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("sections.circuitBreaker.maxRetryAttempts.desc")}
                    </p>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* 超时配置 */}
          <Collapsible open={openSections.timeout} onOpenChange={() => toggleSection("timeout")}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center justify-between w-full py-4 border-t hover:bg-muted/50 transition-colors cursor-pointer"
                disabled={isPending}
              >
                <div className="flex items-center gap-2">
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      openSections.timeout ? "rotate-180" : ""
                    }`}
                  />
                  <span className="text-sm font-medium">{t("sections.timeout.title")}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t("sections.timeout.summary", {
                    streaming:
                      firstByteTimeoutStreamingSeconds != null &&
                      !Number.isNaN(firstByteTimeoutStreamingSeconds)
                        ? firstByteTimeoutStreamingSeconds
                        : PROVIDER_TIMEOUT_DEFAULTS.FIRST_BYTE_TIMEOUT_STREAMING_MS / 1000,
                    idle:
                      streamingIdleTimeoutSeconds != null &&
                      !Number.isNaN(streamingIdleTimeoutSeconds)
                        ? streamingIdleTimeoutSeconds
                        : PROVIDER_TIMEOUT_DEFAULTS.STREAMING_IDLE_TIMEOUT_MS / 1000,
                    nonStreaming:
                      requestTimeoutNonStreamingSeconds != null &&
                      !Number.isNaN(requestTimeoutNonStreamingSeconds)
                        ? requestTimeoutNonStreamingSeconds
                        : PROVIDER_TIMEOUT_DEFAULTS.REQUEST_TIMEOUT_NON_STREAMING_MS / 1000,
                  })}
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pb-4">
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{t("sections.timeout.desc")}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label
                      htmlFor={
                        isEdit
                          ? "edit-first-byte-timeout-streaming"
                          : "first-byte-timeout-streaming"
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        {t("sections.timeout.streamingFirstByte.label")}
                        {t("sections.timeout.streamingFirstByte.core") && (
                          <span className="text-orange-500 text-[10px] font-medium px-1.5 py-0.5 bg-orange-50 dark:bg-orange-950 rounded border border-orange-200 dark:border-orange-800">
                            {t("common.core")}
                          </span>
                        )}
                      </span>
                    </Label>
                    <Input
                      id={
                        isEdit
                          ? "edit-first-byte-timeout-streaming"
                          : "first-byte-timeout-streaming"
                      }
                      type="number"
                      value={firstByteTimeoutStreamingSeconds ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFirstByteTimeoutStreamingSeconds(
                          val === "" ? undefined : parseInt(val, 10)
                        );
                      }}
                      placeholder={t("sections.timeout.streamingFirstByte.placeholder")}
                      disabled={isPending}
                      min="0"
                      max="180"
                      step="1"
                      className="border-orange-200 focus:border-orange-500 focus:ring-orange-500"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("sections.timeout.streamingFirstByte.desc")}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor={isEdit ? "edit-streaming-idle-timeout" : "streaming-idle-timeout"}
                    >
                      <span className="inline-flex items-center gap-1">
                        {t("sections.timeout.streamingIdle.label")}
                        {t("sections.timeout.streamingIdle.core") && (
                          <span className="text-orange-500 text-[10px] font-medium px-1.5 py-0.5 bg-orange-50 dark:bg-orange-950 rounded border border-orange-200 dark:border-orange-800">
                            {t("common.core")}
                          </span>
                        )}
                      </span>
                    </Label>
                    <Input
                      id={isEdit ? "edit-streaming-idle-timeout" : "streaming-idle-timeout"}
                      type="number"
                      value={streamingIdleTimeoutSeconds ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setStreamingIdleTimeoutSeconds(val === "" ? undefined : parseInt(val, 10));
                      }}
                      placeholder={t("sections.timeout.streamingIdle.placeholder")}
                      disabled={isPending}
                      min="0"
                      max="600"
                      step="1"
                      className="border-orange-200 focus:border-orange-500 focus:ring-orange-500"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("sections.timeout.streamingIdle.desc")}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor={
                        isEdit
                          ? "edit-request-timeout-non-streaming"
                          : "request-timeout-non-streaming"
                      }
                    >
                      {t("sections.timeout.nonStreamingTotal.label")}
                    </Label>
                    <Input
                      id={
                        isEdit
                          ? "edit-request-timeout-non-streaming"
                          : "request-timeout-non-streaming"
                      }
                      type="number"
                      value={requestTimeoutNonStreamingSeconds ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRequestTimeoutNonStreamingSeconds(
                          val === "" ? undefined : parseInt(val, 10)
                        );
                      }}
                      placeholder={t("sections.timeout.nonStreamingTotal.placeholder")}
                      disabled={isPending}
                      min="0"
                      max="1800"
                      step="1"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("sections.timeout.nonStreamingTotal.desc")}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground italic">
                  {t("sections.timeout.disableHint")}
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* 代理配置 */}
          <Collapsible open={openSections.proxy} onOpenChange={() => toggleSection("proxy")}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center justify-between w-full py-4 border-t hover:bg-muted/50 transition-colors cursor-pointer"
                disabled={isPending}
              >
                <div className="flex items-center gap-2">
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      openSections.proxy ? "rotate-180" : ""
                    }`}
                  />
                  <span className="text-sm font-medium">{t("sections.proxy.title")}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {proxyUrl.trim()
                    ? t("sections.proxy.summary.configured")
                    : t("sections.proxy.summary.none")}
                  {proxyUrl.trim() && proxyFallbackToDirect
                    ? t("sections.proxy.summary.fallback")
                    : ""}
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pb-4">
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{t("sections.proxy.desc")}</p>
                </div>

                {/* 代理地址输入 */}
                <div className="space-y-2">
                  <Label htmlFor={isEdit ? "edit-proxy-url" : "proxy-url"}>
                    {t("sections.proxy.url.label")}
                    <span className="text-xs text-muted-foreground ml-1">
                      {t("sections.proxy.url.optional")}
                    </span>
                  </Label>
                  <Input
                    id={isEdit ? "edit-proxy-url" : "proxy-url"}
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    placeholder={t("sections.proxy.url.placeholder")}
                    disabled={isPending}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("sections.proxy.url.formats")}{" "}
                    <code className="bg-muted px-1 rounded">http://</code>、
                    <code className="bg-muted px-1 rounded">https://</code>、
                    <code className="bg-muted px-1 rounded">socks4://</code>、
                    <code className="bg-muted px-1 rounded">socks5://</code>
                  </p>
                </div>

                {/* 降级策略开关 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor={isEdit ? "edit-proxy-fallback" : "proxy-fallback"}>
                        {t("sections.proxy.fallback.label")}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {t("sections.proxy.fallback.desc")}
                      </p>
                    </div>
                    <Switch
                      id={isEdit ? "edit-proxy-fallback" : "proxy-fallback"}
                      checked={proxyFallbackToDirect}
                      onCheckedChange={setProxyFallbackToDirect}
                      disabled={isPending}
                    />
                  </div>
                </div>

                {/* 测试连接按钮 */}
                <div className="space-y-2">
                  <Label>{t("sections.proxy.test.label")}</Label>
                  <ProxyTestButton
                    providerUrl={url}
                    proxyUrl={proxyUrl}
                    proxyFallbackToDirect={proxyFallbackToDirect}
                    disabled={isPending || !url.trim()}
                  />
                  <p className="text-xs text-muted-foreground">{t("sections.proxy.test.desc")}</p>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* API 测试 */}
          <Collapsible open={openSections.apiTest} onOpenChange={() => toggleSection("apiTest")}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center justify-between w-full py-4 border-t hover:bg-muted/50 transition-colors cursor-pointer"
                disabled={isPending}
              >
                <div className="flex items-center gap-2">
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      openSections.apiTest ? "rotate-180" : ""
                    }`}
                  />
                  <span className="text-sm font-medium">{t("sections.apiTest.title")}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t("sections.apiTest.summary")}
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pb-4">
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{t("sections.apiTest.desc")}</p>
                </div>

                <div className="space-y-2">
                  <ApiTestButton
                    providerUrl={url}
                    apiKey={key}
                    proxyUrl={proxyUrl}
                    proxyFallbackToDirect={proxyFallbackToDirect}
                    providerId={provider?.id}
                    providerType={providerType}
                    allowedModels={allowedModels}
                    enableMultiProviderTypes={enableMultiProviderTypes}
                    disabled={isPending || !url.trim()}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* MCP 透传配置 */}
          <Collapsible
            open={openSections.mcpPassthrough}
            onOpenChange={() => toggleSection("mcpPassthrough")}
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center justify-between w-full py-4 border-t hover:bg-muted/50 transition-colors cursor-pointer"
                disabled={isPending}
              >
                <div className="flex items-center gap-2">
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      openSections.mcpPassthrough ? "rotate-180" : ""
                    }`}
                  />
                  <span className="text-sm font-medium">{t("sections.mcpPassthrough.title")}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {mcpPassthroughType === "none" && t("sections.mcpPassthrough.summary.none")}
                  {mcpPassthroughType === "minimax" && t("sections.mcpPassthrough.summary.minimax")}
                  {mcpPassthroughType === "glm" && t("sections.mcpPassthrough.summary.glm")}
                  {mcpPassthroughType === "custom" && t("sections.mcpPassthrough.summary.custom")}
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pb-4">
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {t("sections.mcpPassthrough.desc")}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={isEdit ? "edit-mcp-passthrough" : "mcp-passthrough"}>
                    {t("sections.mcpPassthrough.select.label")}
                  </Label>
                  <Select
                    value={mcpPassthroughType}
                    onValueChange={(value) => setMcpPassthroughType(value as McpPassthroughType)}
                    disabled={isPending}
                  >
                    <SelectTrigger id={isEdit ? "edit-mcp-passthrough" : "mcp-passthrough"}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        <div className="space-y-1">
                          <div className="font-medium">
                            {t("sections.mcpPassthrough.select.none.label")}
                          </div>
                          <div className="text-xs text-muted-foreground max-w-xs">
                            {t("sections.mcpPassthrough.select.none.desc")}
                          </div>
                        </div>
                      </SelectItem>
                      <SelectItem value="minimax">
                        <div className="space-y-1">
                          <div className="font-medium">
                            {t("sections.mcpPassthrough.select.minimax.label")}
                          </div>
                          <div className="text-xs text-muted-foreground max-w-xs">
                            {t("sections.mcpPassthrough.select.minimax.desc")}
                          </div>
                        </div>
                      </SelectItem>
                      <SelectItem value="glm">
                        <div className="space-y-1">
                          <div className="font-medium">
                            {t("sections.mcpPassthrough.select.glm.label")}
                          </div>
                          <div className="text-xs text-muted-foreground max-w-xs">
                            {t("sections.mcpPassthrough.select.glm.desc")}
                          </div>
                        </div>
                      </SelectItem>
                      <SelectItem value="custom">
                        <div className="space-y-1">
                          <div className="font-medium">
                            {t("sections.mcpPassthrough.select.custom.label")}
                          </div>
                          <div className="text-xs text-muted-foreground max-w-xs">
                            {t("sections.mcpPassthrough.select.custom.desc")}
                          </div>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t("sections.mcpPassthrough.hint")}
                  </p>
                </div>

                {/* MCP 透传 URL 配置 */}
                {mcpPassthroughType !== "none" && (
                  <div className="space-y-2">
                    <Label htmlFor={isEdit ? "edit-mcp-passthrough-url" : "mcp-passthrough-url"}>
                      {t("sections.mcpPassthrough.urlLabel")}
                    </Label>
                    <Input
                      id={isEdit ? "edit-mcp-passthrough-url" : "mcp-passthrough-url"}
                      value={mcpPassthroughUrl}
                      onChange={(e) => setMcpPassthroughUrl(e.target.value)}
                      placeholder={t("sections.mcpPassthrough.urlPlaceholder")}
                      disabled={isPending}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("sections.mcpPassthrough.urlDesc")}
                    </p>
                    {!mcpPassthroughUrl && url && (
                      <p className="text-xs text-muted-foreground">
                        {t("sections.mcpPassthrough.urlAuto", {
                          url: extractBaseUrl(url),
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* failureThreshold 特殊值确认对话框 */}
          <AlertDialog
            open={showFailureThresholdConfirm}
            onOpenChange={setShowFailureThresholdConfirm}
          >
            <AlertDialogContent>
              <AlertHeader>
                <AlertTitle>{t("failureThresholdConfirmDialog.title")}</AlertTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3">
                    {failureThreshold === 0 ? (
                      <p>
                        {t("failureThresholdConfirmDialog.descriptionDisabledPrefix")}
                        <strong>
                          {t("failureThresholdConfirmDialog.descriptionDisabledValue")}
                        </strong>
                        {t("failureThresholdConfirmDialog.descriptionDisabledMiddle")}
                        <strong>
                          {t("failureThresholdConfirmDialog.descriptionDisabledAction")}
                        </strong>
                        {t("failureThresholdConfirmDialog.descriptionDisabledSuffix")}
                      </p>
                    ) : (
                      <p>
                        {t("failureThresholdConfirmDialog.descriptionHighValuePrefix")}
                        <strong>{failureThreshold}</strong>
                        {t("failureThresholdConfirmDialog.descriptionHighValueSuffix")}
                      </p>
                    )}
                    <p>{t("failureThresholdConfirmDialog.confirmQuestion")}</p>
                  </div>
                </AlertDialogDescription>
              </AlertHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("failureThresholdConfirmDialog.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setShowFailureThresholdConfirm(false);
                    performSubmit();
                  }}
                >
                  {t("failureThresholdConfirmDialog.confirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <DialogFooter className="flex-shrink-0 pt-4 border-t mt-4">
          {isEdit ? (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 w-full">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive" disabled={isPending}>
                    {t("buttons.delete")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertHeader>
                    <AlertTitle>{t("deleteDialog.title")}</AlertTitle>
                    <AlertDialogDescription>
                      {t("deleteDialog.description", {
                        name: provider?.name ?? "",
                      })}
                    </AlertDialogDescription>
                  </AlertHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("deleteDialog.cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        if (!provider) return;
                        startTransition(async () => {
                          try {
                            const res = await removeProvider(provider.id);
                            if (!res.ok) {
                              toast.error(res.error || t("errors.deleteFailed"));
                              return;
                            }
                            onSuccess?.();
                          } catch (e) {
                            console.error(t("errors.deleteFailed"), e);
                            toast.error(t("errors.deleteFailed"));
                          }
                        });
                      }}
                    >
                      {t("deleteDialog.confirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <Button type="submit" disabled={isPending}>
                {isPending ? t("buttons.updating") : t("buttons.update")}
              </Button>
            </div>
          ) : (
            <div className="flex justify-end gap-2 w-full">
              <Button type="submit" disabled={isPending}>
                {isPending ? t("buttons.submitting") : t("buttons.submit")}
              </Button>
            </div>
          )}
        </DialogFooter>
      </form>
    </TooltipProvider>
  );
}

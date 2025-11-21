"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { TagInput } from "@/components/ui/tag-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState, useTransition, useEffect, useRef } from "react";
import { addProvider, editProvider, removeProvider } from "@/actions/providers";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader as AlertHeader,
  AlertDialogTitle as AlertTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { ProviderDisplay, ProviderType, CodexInstructionsStrategy } from "@/types/provider";
import { validateNumericField, isValidUrl } from "@/lib/utils/validation";
import { PROVIDER_DEFAULTS, PROVIDER_TIMEOUT_DEFAULTS } from "@/lib/constants/provider.constants";
import { toast } from "sonner";
import { ModelMultiSelect } from "../model-multi-select";
import { ModelRedirectEditor } from "../model-redirect-editor";
import { ProxyTestButton } from "./proxy-test-button";
import { ApiTestButton } from "./api-test-button";
import { UrlPreview } from "./url-preview";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

type Mode = "create" | "edit";

interface ProviderFormProps {
  mode: Mode;
  onSuccess?: () => void;
  provider?: ProviderDisplay; // edit 模式需要，create 可空
  cloneProvider?: ProviderDisplay; // create 模式用于克隆数据
  enableMultiProviderTypes: boolean;
}

export function ProviderForm({
  mode,
  onSuccess,
  provider,
  cloneProvider,
  enableMultiProviderTypes,
}: ProviderFormProps) {
  const t = useTranslations("settings.providers.form");
  const tUI = useTranslations("ui.tagInput");
  const isEdit = mode === "edit";
  const [isPending, startTransition] = useTransition();

  // 名称输入框引用，用于自动聚焦
  const nameInputRef = useRef<HTMLInputElement>(null);

  // 获取初始数据源：编辑模式用 provider，创建模式用 cloneProvider（如果有）
  const sourceProvider = isEdit ? provider : cloneProvider;

  const [name, setName] = useState(
    isEdit ? (provider?.name ?? "") : cloneProvider ? `${cloneProvider.name}_Copy` : ""
  );
  const [url, setUrl] = useState(sourceProvider?.url ?? "");
  const [key, setKey] = useState(""); // 编辑时留空代表不更新
  const [providerType, setProviderType] = useState<ProviderType>(
    sourceProvider?.providerType ?? "claude"
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
  const [limitConcurrentSessions, setLimitConcurrentSessions] = useState<number | null>(
    sourceProvider?.limitConcurrentSessions ?? null
  );
  const [allowedModels, setAllowedModels] = useState<string[]>(sourceProvider?.allowedModels ?? []);
  const [joinClaudePool, setJoinClaudePool] = useState<boolean>(
    sourceProvider?.joinClaudePool ?? false
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
  const [websiteUrl, setWebsiteUrl] = useState<string>(sourceProvider?.websiteUrl ?? "");

  // Codex Instructions 策略配置
  const [codexInstructionsStrategy, setCodexInstructionsStrategy] =
    useState<CodexInstructionsStrategy>(sourceProvider?.codexInstructionsStrategy ?? "auto");

  // 折叠区域状态管理
  type SectionKey =
    | "routing"
    | "rateLimit"
    | "circuitBreaker"
    | "proxy"
    | "timeout"
    | "apiTest"
    | "codexStrategy";
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    routing: false,
    rateLimit: false,
    circuitBreaker: false,
    proxy: false,
    timeout: false,
    apiTest: false,
    codexStrategy: false,
  });

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
      codexStrategy: true,
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
      codexStrategy: false,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !url.trim() || (!isEdit && !key.trim())) {
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
            join_claude_pool?: boolean;
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
            limit_concurrent_sessions?: number | null;
            circuit_breaker_failure_threshold?: number;
            circuit_breaker_open_duration?: number;
            circuit_breaker_half_open_success_threshold?: number;
            proxy_url?: string | null;
            proxy_fallback_to_direct?: boolean;
            first_byte_timeout_streaming_ms?: number;
            streaming_idle_timeout_ms?: number;
            request_timeout_non_streaming_ms?: number;
            website_url?: string | null;
            codex_instructions_strategy?: CodexInstructionsStrategy;
            tpm?: number | null;
            rpm?: number | null;
            rpd?: number | null;
            cc?: number | null;
          } = {
            name: name.trim(),
            url: url.trim(),
            provider_type: providerType,
            model_redirects: parsedModelRedirects,
            allowed_models: allowedModels.length > 0 ? allowedModels : null,
            join_claude_pool: joinClaudePool,
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
            limit_concurrent_sessions: limitConcurrentSessions,
            circuit_breaker_failure_threshold: failureThreshold ?? 5,
            circuit_breaker_open_duration: openDurationMinutes
              ? openDurationMinutes * 60000
              : 1800000,
            circuit_breaker_half_open_success_threshold: halfOpenSuccessThreshold ?? 2,
            proxy_url: proxyUrl.trim() || null,
            proxy_fallback_to_direct: proxyFallbackToDirect,
            // ⭐ 编辑模式：undefined 代表不更新(沿用数据库旧值),不能回退到默认值
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
            codex_instructions_strategy: codexInstructionsStrategy,
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
            model_redirects: parsedModelRedirects,
            allowed_models: allowedModels.length > 0 ? allowedModels : null,
            join_claude_pool: joinClaudePool,
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
            limit_concurrent_sessions: limitConcurrentSessions ?? 0,
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
            codex_instructions_strategy: codexInstructionsStrategy,
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
          setModelRedirects({});
          setAllowedModels([]);
          setJoinClaudePool(false);
          setPriority(0);
          setWeight(1);
          setCostMultiplier(1.0);
          setGroupTag([]);
          setLimit5hUsd(null);
          setLimitDailyUsd(null);
          setDailyResetTime("00:00");
          setLimitWeeklyUsd(null);
          setLimitMonthlyUsd(null);
          setLimitConcurrentSessions(null);
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
          setCodexInstructionsStrategy("auto");
        }
        onSuccess?.();
      } catch (error) {
        console.error(isEdit ? t("errors.updateFailed") : t("errors.addFailed"), error);
        toast.error(isEdit ? t("errors.updateFailed") : t("errors.addFailed"));
      }
    });
  };

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>{isEdit ? t("title.edit") : t("title.create")}</DialogTitle>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4">
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
          {/* URL 预览组件 - 实时显示端点拼接结果 */}
          {url.trim() && <UrlPreview baseUrl={url} providerType={providerType} />}
        </div>

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
              className="flex items-center justify-between w-full py-4 border-t hover:bg-muted/50 transition-colors"
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
                      t("sections.routing.summary.models", { count: allowedModels.length })
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
                    <SelectItem value="claude">{t("providerTypes.claude")}</SelectItem>
                    <SelectItem value="claude-auth">{t("providerTypes.claudeAuth")}</SelectItem>
                    <SelectItem value="codex">{t("providerTypes.codex")}</SelectItem>
                    <SelectItem value="gemini">{t("providerTypes.gemini")}</SelectItem>
                    <SelectItem value="gemini-cli">{t("providerTypes.geminiCli")}</SelectItem>
                    <SelectItem value="openai-compatible" disabled={!enableMultiProviderTypes}>
                      <>
                        {t("providerTypes.openaiCompatible")}{" "}
                        {!enableMultiProviderTypes && t("providerTypes.openaiCompatibleDisabled")}
                      </>
                    </SelectItem>
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

              {/* joinClaudePool 开关 - 仅非 Claude 供应商显示 */}
              {providerType !== "claude" &&
                (() => {
                  // 检查是否有重定向到 Claude 模型的映射
                  const hasClaudeRedirects = Object.values(modelRedirects).some((target) =>
                    target.startsWith("claude-")
                  );

                  if (!hasClaudeRedirects) return null;

                  return (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label htmlFor={isEdit ? "edit-join-claude-pool" : "join-claude-pool"}>
                            {t("sections.routing.joinClaudePool.label")}
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            {t("sections.routing.joinClaudePool.desc")}
                          </p>
                        </div>
                        <Switch
                          id={isEdit ? "edit-join-claude-pool" : "join-claude-pool"}
                          checked={joinClaudePool}
                          onCheckedChange={setJoinClaudePool}
                          disabled={isPending}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("sections.routing.joinClaudePool.help")}
                      </p>
                    </div>
                  );
                })()}

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
                      | "codex"
                      | "gemini"
                      | "gemini-cli"
                      | "openai-compatible"
                  }
                  selectedModels={allowedModels}
                  onChange={setAllowedModels}
                  disabled={isPending}
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
                <div className="text-sm font-medium">
                  {t("sections.routing.scheduleParams.title")}
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor={isEdit ? "edit-priority" : "priority"}>
                      {t("sections.routing.scheduleParams.priority.label")}
                    </Label>
                    <Input
                      id={isEdit ? "edit-priority" : "priority"}
                      type="number"
                      value={priority}
                      onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
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
                      onChange={(e) => setWeight(parseInt(e.target.value) || 1)}
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
                      onChange={(e) => setCostMultiplier(parseFloat(e.target.value) || 1.0)}
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
                  <Label htmlFor={isEdit ? "edit-group" : "group"}>
                    {t("sections.routing.scheduleParams.group.label")}
                  </Label>
                  <TagInput
                    id={isEdit ? "edit-group" : "group"}
                    value={groupTag}
                    onChange={setGroupTag}
                    placeholder={t("sections.routing.scheduleParams.group.placeholder")}
                    disabled={isPending}
                    maxTagLength={50}
                    onInvalidTag={(tag, reason) => {
                      const messages: Record<string, string> = {
                        empty: tUI("emptyTag"),
                        duplicate: tUI("duplicateTag"),
                        too_long: tUI("tooLong", { max: 50 }),
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
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* 限流配置 */}
        <Collapsible open={openSections.rateLimit} onOpenChange={() => toggleSection("rateLimit")}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center justify-between w-full py-4 border-t hover:bg-muted/50 transition-colors"
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
                    limits.push(t("sections.rateLimit.summary.fiveHour", { amount: limit5hUsd }));
                  if (limitDailyUsd)
                    limits.push(
                      t("sections.rateLimit.summary.daily", {
                        amount: limitDailyUsd,
                        resetTime: dailyResetTime,
                      })
                    );
                  if (limitWeeklyUsd)
                    limits.push(t("sections.rateLimit.summary.weekly", { amount: limitWeeklyUsd }));
                  if (limitMonthlyUsd)
                    limits.push(
                      t("sections.rateLimit.summary.monthly", { amount: limitMonthlyUsd })
                    );
                  if (limitConcurrentSessions)
                    limits.push(
                      t("sections.rateLimit.summary.concurrent", { count: limitConcurrentSessions })
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
                    onChange={(e) => setLimit5hUsd(validateNumericField(e.target.value))}
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
                    onChange={(e) => setLimitDailyUsd(validateNumericField(e.target.value))}
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
                    onChange={(e) => setLimitWeeklyUsd(validateNumericField(e.target.value))}
                    placeholder={t("sections.rateLimit.limitWeekly.placeholder")}
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
                    onChange={(e) => setLimitMonthlyUsd(validateNumericField(e.target.value))}
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
              className="flex items-center justify-between w-full py-4 border-t hover:bg-muted/50 transition-colors"
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
                })}
              </span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pb-4">
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("sections.circuitBreaker.desc")}</p>
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
                      setFailureThreshold(val === "" ? undefined : parseInt(val));
                    }}
                    placeholder={t("sections.circuitBreaker.failureThreshold.placeholder")}
                    disabled={isPending}
                    min="1"
                    max="100"
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
                      setOpenDurationMinutes(val === "" ? undefined : parseInt(val));
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
                      setHalfOpenSuccessThreshold(val === "" ? undefined : parseInt(val));
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
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* 超时配置 */}
        <Collapsible open={openSections.timeout} onOpenChange={(open) => toggleSection("timeout")}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center justify-between w-full py-4 border-t hover:bg-muted/50 transition-colors"
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
                      isEdit ? "edit-first-byte-timeout-streaming" : "first-byte-timeout-streaming"
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
                      isEdit ? "edit-first-byte-timeout-streaming" : "first-byte-timeout-streaming"
                    }
                    type="number"
                    value={firstByteTimeoutStreamingSeconds ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFirstByteTimeoutStreamingSeconds(val === "" ? undefined : parseInt(val));
                    }}
                    placeholder={t("sections.timeout.streamingFirstByte.placeholder")}
                    disabled={isPending}
                    min="0"
                    max="120"
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
                      setStreamingIdleTimeoutSeconds(val === "" ? undefined : parseInt(val));
                    }}
                    placeholder={t("sections.timeout.streamingIdle.placeholder")}
                    disabled={isPending}
                    min="0"
                    max="120"
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
                      setRequestTimeoutNonStreamingSeconds(val === "" ? undefined : parseInt(val));
                    }}
                    placeholder={t("sections.timeout.nonStreamingTotal.placeholder")}
                    disabled={isPending}
                    min="0"
                    max="1200"
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
              className="flex items-center justify-between w-full py-4 border-t hover:bg-muted/50 transition-colors"
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
              className="flex items-center justify-between w-full py-4 border-t hover:bg-muted/50 transition-colors"
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
              <span className="text-xs text-muted-foreground">{t("sections.apiTest.summary")}</span>
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
                <p className="text-xs text-muted-foreground">{t("sections.apiTest.notice")}</p>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Codex Instructions 策略配置 - 仅 Codex 供应商显示 */}
        {providerType === "codex" && (
          <Collapsible
            open={openSections.codexStrategy}
            onOpenChange={() => toggleSection("codexStrategy")}
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center justify-between w-full py-4 border-t hover:bg-muted/50 transition-colors"
                disabled={isPending}
              >
                <div className="flex items-center gap-2">
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      openSections.codexStrategy ? "rotate-180" : ""
                    }`}
                  />
                  <span className="text-sm font-medium">{t("sections.codexStrategy.title")}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {codexInstructionsStrategy === "auto" && t("sections.codexStrategy.summary.auto")}
                  {codexInstructionsStrategy === "force_official" &&
                    t("sections.codexStrategy.summary.force")}
                  {codexInstructionsStrategy === "keep_original" &&
                    t("sections.codexStrategy.summary.keep")}
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pb-4">
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {t("sections.codexStrategy.desc")}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={isEdit ? "edit-codex-strategy" : "codex-strategy"}>
                    {t("sections.codexStrategy.select.label")}
                  </Label>
                  <Select
                    value={codexInstructionsStrategy}
                    onValueChange={(value) =>
                      setCodexInstructionsStrategy(value as CodexInstructionsStrategy)
                    }
                    disabled={isPending}
                  >
                    <SelectTrigger id={isEdit ? "edit-codex-strategy" : "codex-strategy"}>
                      <SelectValue placeholder={t("sections.codexStrategy.select.placeholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        <div className="space-y-1">
                          <div className="font-medium">
                            {t("sections.codexStrategy.select.auto.label")}
                          </div>
                          <div className="text-xs text-muted-foreground max-w-xs">
                            {t("sections.codexStrategy.select.auto.desc")}
                          </div>
                        </div>
                      </SelectItem>
                      <SelectItem value="force_official">
                        <div className="space-y-1">
                          <div className="font-medium">
                            {t("sections.codexStrategy.select.force.label")}
                          </div>
                          <div className="text-xs text-muted-foreground max-w-xs">
                            {t("sections.codexStrategy.select.force.desc")}
                          </div>
                        </div>
                      </SelectItem>
                      <SelectItem value="keep_original">
                        <div className="space-y-1">
                          <div className="font-medium">
                            {t("sections.codexStrategy.select.keep.label")}
                          </div>
                          <div className="text-xs text-muted-foreground max-w-xs">
                            {t("sections.codexStrategy.select.keep.desc")}
                          </div>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t("sections.codexStrategy.hint")}
                  </p>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {isEdit ? (
          <div className="flex items-center justify-between pt-4">
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
                    {t("deleteDialog.description", { name: provider?.name ?? "" })}
                  </AlertDialogDescription>
                </AlertHeader>
                <div className="flex gap-2 justify-end">
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
                </div>
              </AlertDialogContent>
            </AlertDialog>

            <Button type="submit" disabled={isPending}>
              {isPending ? t("buttons.updating") : t("buttons.update")}
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-4">
            <Button type="submit" disabled={isPending}>
              {isPending ? t("buttons.submitting") : t("buttons.submit")}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}

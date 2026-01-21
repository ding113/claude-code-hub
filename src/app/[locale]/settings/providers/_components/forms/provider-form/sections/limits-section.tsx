"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  Clock,
  DollarSign,
  Gauge,
  RefreshCw,
  Shield,
  Users,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROVIDER_DEFAULTS } from "@/lib/constants/provider.constants";
import { cn } from "@/lib/utils";
import { FieldGroup, SectionCard, SmartInputWrapper } from "../components/section-card";
import { useProviderForm } from "../provider-form-context";

// Validation helpers
function validatePositiveDecimalField(value: string): number | null {
  if (value === "") return null;
  const num = parseFloat(value);
  if (Number.isNaN(num) || num < 0) return null;
  return num;
}

function validateNumericField(value: string): number | null {
  if (value === "") return null;
  const num = parseInt(value, 10);
  if (Number.isNaN(num) || num < 0) return null;
  return num;
}

// Visual limit card component
interface LimitCardProps {
  label: string;
  value: number | null;
  unit: string;
  icon: React.ElementType;
  color: string;
  id: string;
  placeholder: string;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  step?: string;
  min?: string;
  isDecimal?: boolean;
}

function LimitCard({
  label,
  value,
  unit,
  icon: Icon,
  color,
  id,
  placeholder,
  onChange,
  disabled,
  step = "0.01",
  min = "0",
  isDecimal = true,
}: LimitCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card/50 p-4",
        "transition-all duration-200 hover:border-border",
        value !== null && "border-primary/30"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn("flex items-center justify-center w-10 h-10 rounded-lg shrink-0", color)}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="flex-1 min-w-0 space-y-2">
          <label htmlFor={id} className="text-sm font-medium text-foreground">
            {label}
          </label>
          <div className="relative">
            <Input
              id={id}
              type="number"
              value={value?.toString() ?? ""}
              onChange={(e) =>
                onChange(
                  isDecimal
                    ? validatePositiveDecimalField(e.target.value)
                    : validateNumericField(e.target.value)
                )
              }
              placeholder={placeholder}
              disabled={disabled}
              min={min}
              step={step}
              className="pr-12 font-mono"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              {unit}
            </span>
          </div>
        </div>
      </div>
      {value !== null && (
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/50 origin-left"
        />
      )}
    </div>
  );
}

export function LimitsSection() {
  const t = useTranslations("settings.providers.form");
  const { state, dispatch, mode } = useProviderForm();
  const isEdit = mode === "edit";

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      {/* USD Spending Limits */}
      <SectionCard
        title={t("sections.rateLimit.title")}
        description={t("sections.rateLimit.desc")}
        icon={DollarSign}
        variant="highlight"
      >
        <div className="space-y-4">
          {/* Time-based limits grid */}
          <FieldGroup label={t("sections.limits.timeBased")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <LimitCard
                label={t("sections.rateLimit.limit5h.label")}
                value={state.rateLimit.limit5hUsd}
                unit="USD"
                icon={Clock}
                color="bg-blue-500/10 text-blue-500"
                id={isEdit ? "edit-limit-5h" : "limit-5h"}
                placeholder={t("sections.rateLimit.limit5h.placeholder")}
                onChange={(value) => dispatch({ type: "SET_LIMIT_5H_USD", payload: value })}
                disabled={state.ui.isPending}
              />
              <LimitCard
                label={t("sections.rateLimit.limitDaily.label")}
                value={state.rateLimit.limitDailyUsd}
                unit="USD"
                icon={DollarSign}
                color="bg-green-500/10 text-green-500"
                id={isEdit ? "edit-limit-daily" : "limit-daily"}
                placeholder={t("sections.rateLimit.limitDaily.placeholder")}
                onChange={(value) => dispatch({ type: "SET_LIMIT_DAILY_USD", payload: value })}
                disabled={state.ui.isPending}
              />
              <LimitCard
                label={t("sections.rateLimit.limitWeekly.label")}
                value={state.rateLimit.limitWeeklyUsd}
                unit="USD"
                icon={DollarSign}
                color="bg-purple-500/10 text-purple-500"
                id={isEdit ? "edit-limit-weekly" : "limit-weekly"}
                placeholder={t("sections.rateLimit.limitWeekly.placeholder")}
                onChange={(value) => dispatch({ type: "SET_LIMIT_WEEKLY_USD", payload: value })}
                disabled={state.ui.isPending}
              />
              <LimitCard
                label={t("sections.rateLimit.limitMonthly.label")}
                value={state.rateLimit.limitMonthlyUsd}
                unit="USD"
                icon={DollarSign}
                color="bg-orange-500/10 text-orange-500"
                id={isEdit ? "edit-limit-monthly" : "limit-monthly"}
                placeholder={t("sections.rateLimit.limitMonthly.placeholder")}
                onChange={(value) => dispatch({ type: "SET_LIMIT_MONTHLY_USD", payload: value })}
                disabled={state.ui.isPending}
              />
            </div>
          </FieldGroup>

          {/* Daily Reset Settings */}
          <FieldGroup label={t("sections.limits.dailyReset")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SmartInputWrapper
                label={t("sections.rateLimit.dailyResetMode.label")}
                description={
                  state.rateLimit.dailyResetMode === "fixed"
                    ? t("sections.rateLimit.dailyResetMode.desc.fixed")
                    : t("sections.rateLimit.dailyResetMode.desc.rolling")
                }
              >
                <Select
                  value={state.rateLimit.dailyResetMode}
                  onValueChange={(value: "fixed" | "rolling") =>
                    dispatch({ type: "SET_DAILY_RESET_MODE", payload: value })
                  }
                  disabled={state.ui.isPending}
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
              </SmartInputWrapper>

              {state.rateLimit.dailyResetMode === "fixed" && (
                <SmartInputWrapper label={t("sections.rateLimit.dailyResetTime.label")}>
                  <Input
                    id={isEdit ? "edit-daily-reset" : "daily-reset"}
                    type="time"
                    value={state.rateLimit.dailyResetTime}
                    onChange={(e) =>
                      dispatch({ type: "SET_DAILY_RESET_TIME", payload: e.target.value || "00:00" })
                    }
                    placeholder="00:00"
                    disabled={state.ui.isPending}
                    step="60"
                  />
                </SmartInputWrapper>
              )}
            </div>
          </FieldGroup>

          {/* Total and Concurrent Limits */}
          <FieldGroup label={t("sections.limits.otherLimits")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <LimitCard
                label={t("sections.rateLimit.limitTotal.label")}
                value={state.rateLimit.limitTotalUsd}
                unit="USD"
                icon={Gauge}
                color="bg-red-500/10 text-red-500"
                id={isEdit ? "edit-limit-total" : "limit-total"}
                placeholder={t("sections.rateLimit.limitTotal.placeholder")}
                onChange={(value) => dispatch({ type: "SET_LIMIT_TOTAL_USD", payload: value })}
                disabled={state.ui.isPending}
              />
              <LimitCard
                label={t("sections.rateLimit.limitConcurrent.label")}
                value={state.rateLimit.limitConcurrentSessions}
                unit=""
                icon={Users}
                color="bg-cyan-500/10 text-cyan-500"
                id={isEdit ? "edit-limit-concurrent" : "limit-concurrent"}
                placeholder={t("sections.rateLimit.limitConcurrent.placeholder")}
                onChange={(value) =>
                  dispatch({ type: "SET_LIMIT_CONCURRENT_SESSIONS", payload: value })
                }
                disabled={state.ui.isPending}
                step="1"
                isDecimal={false}
              />
            </div>
          </FieldGroup>
        </div>
      </SectionCard>

      {/* Circuit Breaker Settings */}
      <SectionCard
        title={t("sections.circuitBreaker.title")}
        description={t("sections.circuitBreaker.desc")}
        icon={Shield}
      >
        <div className="space-y-4">
          {/* Circuit Breaker Parameters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <SmartInputWrapper
              label={t("sections.circuitBreaker.failureThreshold.label")}
              description={t("sections.circuitBreaker.failureThreshold.desc")}
            >
              <div className="relative">
                <Input
                  id={isEdit ? "edit-failure-threshold" : "failure-threshold"}
                  type="number"
                  value={state.circuitBreaker.failureThreshold ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    dispatch({
                      type: "SET_FAILURE_THRESHOLD",
                      payload: val === "" ? undefined : parseInt(val, 10),
                    });
                  }}
                  placeholder={t("sections.circuitBreaker.failureThreshold.placeholder")}
                  disabled={state.ui.isPending}
                  min="0"
                  step="1"
                  className={cn(state.circuitBreaker.failureThreshold === 0 && "border-yellow-500")}
                />
                <AlertTriangle
                  className={cn(
                    "absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4",
                    state.circuitBreaker.failureThreshold === 0
                      ? "text-yellow-500"
                      : "text-muted-foreground/30"
                  )}
                />
              </div>
              {state.circuitBreaker.failureThreshold === 0 && (
                <p className="text-xs text-yellow-600">
                  {t("sections.circuitBreaker.failureThreshold.warning")}
                </p>
              )}
            </SmartInputWrapper>

            <SmartInputWrapper
              label={t("sections.circuitBreaker.openDuration.label")}
              description={t("sections.circuitBreaker.openDuration.desc")}
            >
              <div className="relative">
                <Input
                  id={isEdit ? "edit-open-duration" : "open-duration"}
                  type="number"
                  value={state.circuitBreaker.openDurationMinutes ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    dispatch({
                      type: "SET_OPEN_DURATION_MINUTES",
                      payload: val === "" ? undefined : parseInt(val, 10),
                    });
                  }}
                  placeholder={t("sections.circuitBreaker.openDuration.placeholder")}
                  disabled={state.ui.isPending}
                  min="1"
                  max="1440"
                  step="1"
                  className="pr-12"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  min
                </span>
              </div>
            </SmartInputWrapper>

            <SmartInputWrapper
              label={t("sections.circuitBreaker.successThreshold.label")}
              description={t("sections.circuitBreaker.successThreshold.desc")}
            >
              <Input
                id={isEdit ? "edit-success-threshold" : "success-threshold"}
                type="number"
                value={state.circuitBreaker.halfOpenSuccessThreshold ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  dispatch({
                    type: "SET_HALF_OPEN_SUCCESS_THRESHOLD",
                    payload: val === "" ? undefined : parseInt(val, 10),
                  });
                }}
                placeholder={t("sections.circuitBreaker.successThreshold.placeholder")}
                disabled={state.ui.isPending}
                min="1"
                max="10"
                step="1"
              />
            </SmartInputWrapper>

            <SmartInputWrapper
              label={t("sections.circuitBreaker.maxRetryAttempts.label")}
              description={t("sections.circuitBreaker.maxRetryAttempts.desc")}
            >
              <div className="relative">
                <Input
                  id={isEdit ? "edit-max-retry-attempts" : "max-retry-attempts"}
                  type="number"
                  value={state.circuitBreaker.maxRetryAttempts ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    dispatch({
                      type: "SET_MAX_RETRY_ATTEMPTS",
                      payload: val === "" ? null : parseInt(val, 10),
                    });
                  }}
                  placeholder={t("sections.circuitBreaker.maxRetryAttempts.placeholder")}
                  disabled={state.ui.isPending}
                  min="1"
                  max="10"
                  step="1"
                />
                <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30" />
              </div>
            </SmartInputWrapper>
          </div>

          {/* Circuit Breaker Status Indicator */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
            <Zap className="h-4 w-4 text-primary" />
            <div className="flex-1 text-xs text-muted-foreground">
              {t("sections.circuitBreaker.summary", {
                failureThreshold: state.circuitBreaker.failureThreshold ?? 5,
                openDuration: state.circuitBreaker.openDurationMinutes ?? 30,
                successThreshold: state.circuitBreaker.halfOpenSuccessThreshold ?? 2,
                maxRetryAttempts:
                  state.circuitBreaker.maxRetryAttempts ?? PROVIDER_DEFAULTS.MAX_RETRY_ATTEMPTS,
              })}
            </div>
          </div>
        </div>
      </SectionCard>
    </motion.div>
  );
}

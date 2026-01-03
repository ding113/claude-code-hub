"use client";

import { AlertCircle, ArrowRight, CheckCircle2, Loader2, Settings, Webhook } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { getNotificationSettingsAction } from "@/actions/notifications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { logger } from "@/lib/logger";
import { setOnboardingCompleted, shouldShowOnboarding } from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import {
  collectLegacyWebhooks,
  getUndetectedWebhooks,
  type LegacyWebhookInfo,
  migrateToNewWebhookSystem,
} from "@/lib/webhook/migration";
import type { NotificationSettings } from "@/repository/notifications";
import type { WebhookProviderType } from "@/repository/webhook-targets";

type MigrationStep = "intro" | "platform-select" | "migrating" | "complete";

interface MigrationState {
  step: MigrationStep;
  settings: NotificationSettings | null;
  legacyWebhooks: LegacyWebhookInfo[];
  undetectedUrls: string[];
  platformSelections: Map<string, WebhookProviderType>;
  migrationResult: {
    success: boolean;
    error?: string;
    createdTargets: number;
    createdBindings: number;
  } | null;
}

const PLATFORM_TYPES: WebhookProviderType[] = [
  "wechat",
  "feishu",
  "dingtalk",
  "telegram",
  "custom",
];

// Migration step order for progress indicator
const MIGRATION_STEPS: MigrationStep[] = ["intro", "platform-select", "migrating", "complete"];

export function WebhookMigrationDialog() {
  const t = useTranslations("dashboard.webhookMigration");
  const locale = useLocale();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [state, setState] = useState<MigrationState>({
    step: "intro",
    settings: null,
    legacyWebhooks: [],
    undetectedUrls: [],
    platformSelections: new Map(),
    migrationResult: null,
  });

  const getSafeErrorMessage = useCallback(
    (message?: string) => {
      const fallback = t("errorGeneric");
      const raw = message?.trim();
      if (!raw) return fallback;

      const withoutPrefix = raw
        .replace(/^CREATE_TARGET_FAILED:/, "")
        .replace(/^CREATE_BINDING_FAILED:/, "")
        .trim();

      if (!withoutPrefix) return fallback;
      if (withoutPrefix.toLowerCase() === "unknown error") return fallback;
      if (withoutPrefix.includes("http://") || withoutPrefix.includes("https://")) return fallback;
      if (withoutPrefix.length > 200) return fallback;
      return withoutPrefix;
    },
    [t]
  );

  // Check if we should show the migration dialog
  useEffect(() => {
    let cancelled = false;
    const checkMigration = async () => {
      // Only check if we should show onboarding
      if (!shouldShowOnboarding("webhookMigration")) {
        return;
      }

      try {
        const settings = await getNotificationSettingsAction();
        if (cancelled) {
          return;
        }

        // Check if using legacy mode and has legacy webhooks
        if (settings.useLegacyMode) {
          const legacyWebhooks = collectLegacyWebhooks(settings);
          const undetectedUrls = getUndetectedWebhooks(settings);

          if (legacyWebhooks.length > 0) {
            if (!cancelled) {
              setState((prev) => ({
                ...prev,
                settings,
                legacyWebhooks,
                undetectedUrls,
              }));
              setOpen(true);
            }
          } else {
            // No legacy webhooks, mark as completed
            setOnboardingCompleted("webhookMigration");
          }
        } else {
          // Not in legacy mode, mark as completed
          setOnboardingCompleted("webhookMigration");
        }
      } catch (error) {
        // Don't block user if settings fetch fails, but log for debugging
        logger.warn("[WebhookMigrationDialog] Failed to load notification settings", { error });
      }
    };

    void checkMigration();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSkip = useCallback(() => {
    setOnboardingCompleted("webhookMigration");
    setOpen(false);
  }, []);

  const doMigration = useCallback(async () => {
    if (!state.settings) return;

    setState((prev) => ({ ...prev, step: "migrating" }));

    try {
      const result = await migrateToNewWebhookSystem(state.settings, state.platformSelections);
      const safeResult = result.success
        ? result
        : {
            ...result,
            error: getSafeErrorMessage(result.error),
          };

      setState((prev) => ({
        ...prev,
        step: "complete",
        migrationResult: safeResult,
      }));

      if (result.success) {
        setOnboardingCompleted("webhookMigration");
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        step: "complete",
        migrationResult: {
          success: false,
          error: getSafeErrorMessage(error instanceof Error ? error.message : undefined),
          createdTargets: 0,
          createdBindings: 0,
        },
      }));
    }
  }, [getSafeErrorMessage, state.settings, state.platformSelections]);

  const handleStartMigration = useCallback(() => {
    if (state.undetectedUrls.length > 0) {
      // Need to select platforms for undetected URLs
      setState((prev) => ({ ...prev, step: "platform-select" }));
    } else {
      // All URLs detected, proceed to migration
      doMigration();
    }
  }, [state.undetectedUrls, doMigration]);

  const handlePlatformSelect = useCallback((url: string, platform: WebhookProviderType) => {
    setState((prev) => {
      const newSelections = new Map(prev.platformSelections);
      newSelections.set(url, platform);
      return { ...prev, platformSelections: newSelections };
    });
  }, []);

  const handleNextFromPlatformSelect = useCallback(() => {
    // Check if all undetected URLs have a platform selected
    const allSelected = state.undetectedUrls.every((url) => state.platformSelections.has(url));

    if (allSelected) {
      doMigration();
    }
  }, [state.undetectedUrls, state.platformSelections, doMigration]);

  const handleGoToSettings = useCallback(() => {
    setOpen(false);
    router.push(`/${locale}/settings/notifications`);
  }, [router, locale]);

  // Render step indicator
  const renderStepIndicator = () => {
    const currentIndex = MIGRATION_STEPS.indexOf(state.step);

    return (
      <div className="flex items-center justify-center gap-2 py-4">
        {MIGRATION_STEPS.map((step, index) => (
          <div
            key={step}
            className={cn(
              "h-2 w-2 rounded-full transition-colors",
              index === currentIndex
                ? "bg-primary"
                : index < currentIndex
                  ? "bg-primary/50"
                  : "bg-muted"
            )}
          />
        ))}
      </div>
    );
  };

  // Render intro step
  const renderIntroStep = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Webhook className="h-5 w-5" />
          {t("step1.title")}
        </DialogTitle>
        <DialogDescription className="text-base leading-relaxed pt-2">
          {t("step1.description")}
        </DialogDescription>
      </DialogHeader>

      <div className="py-4">
        <p className="text-sm font-medium text-muted-foreground mb-3">{t("detectedWebhooks")}</p>
        <div className="space-y-3">
          {state.legacyWebhooks.map((webhook) => (
            <div key={webhook.url} className="rounded-lg border p-3 bg-muted/30">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono text-muted-foreground truncate">{webhook.url}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {webhook.notificationTypes.map((type) => (
                      <Badge key={type} variant="secondary" className="text-xs">
                        {t(`notificationTypes.${type}`)}
                      </Badge>
                    ))}
                  </div>
                </div>
                {webhook.detectedProvider ? (
                  <Badge variant="outline" className="shrink-0">
                    {t(`platformOptions.${webhook.detectedProvider}`)}
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="shrink-0">
                    {t("selectPlatform")}
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {renderStepIndicator()}

      <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
        <Button
          type="button"
          variant="ghost"
          onClick={handleSkip}
          className="order-3 sm:order-1 sm:mr-auto"
        >
          {t("skipButton")}
        </Button>
        <Button type="button" onClick={handleStartMigration} className="order-1 sm:order-2">
          {state.undetectedUrls.length > 0 ? t("nextButton") : t("migrateButton")}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </DialogFooter>
    </>
  );

  // Render platform select step
  const renderPlatformSelectStep = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          {t("step2.title")}
        </DialogTitle>
        <DialogDescription className="text-base leading-relaxed pt-2">
          {t("step2.description")}
        </DialogDescription>
      </DialogHeader>

      <div className="py-4 space-y-4">
        {state.undetectedUrls.map((url) => (
          <div key={url} className="rounded-lg border p-4">
            <p className="text-sm font-mono text-muted-foreground mb-3 truncate">{url}</p>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground shrink-0">{t("platformLabel")}:</span>
              <Select
                value={state.platformSelections.get(url) || ""}
                onValueChange={(value) => handlePlatformSelect(url, value as WebhookProviderType)}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={t("selectPlatform")} />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORM_TYPES.map((platform) => (
                    <SelectItem key={platform} value={platform}>
                      {t(`platformOptions.${platform}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
      </div>

      {renderStepIndicator()}

      <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
        <Button
          type="button"
          variant="ghost"
          onClick={handleSkip}
          className="order-3 sm:order-1 sm:mr-auto"
        >
          {t("skipButton")}
        </Button>
        <Button
          type="button"
          onClick={handleNextFromPlatformSelect}
          disabled={!state.undetectedUrls.every((url) => state.platformSelections.has(url))}
          className="order-1 sm:order-2"
        >
          {t("migrateButton")}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </DialogFooter>
    </>
  );

  // Render migrating step
  const renderMigratingStep = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t("migrating")}
        </DialogTitle>
      </DialogHeader>

      <div className="py-8 flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{t("migrating")}</p>
      </div>

      {renderStepIndicator()}
    </>
  );

  // Render complete step
  const renderCompleteStep = () => {
    const isSuccess = state.migrationResult?.success;

    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isSuccess ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : (
              <AlertCircle className="h-5 w-5 text-destructive" />
            )}
            {isSuccess ? t("success") : t("error")}
          </DialogTitle>
          {isSuccess && (
            <DialogDescription className="text-base leading-relaxed pt-2">
              {t("successDescription")}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="py-4">
          {isSuccess ? (
            <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30 p-4">
              <div className="flex items-center gap-4">
                <CheckCircle2 className="h-8 w-8 text-green-500" />
                <div>
                  <p className="font-medium text-green-700 dark:text-green-400">{t("success")}</p>
                  <p className="text-sm text-green-600 dark:text-green-500">
                    {t("successStats", {
                      targets: state.migrationResult?.createdTargets ?? 0,
                      bindings: state.migrationResult?.createdBindings ?? 0,
                    })}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <div className="flex items-start gap-4">
                <AlertCircle className="h-8 w-8 text-destructive shrink-0" />
                <div>
                  <p className="font-medium text-destructive">{t("error")}</p>
                  <p className="text-sm text-destructive/80 mt-1">{state.migrationResult?.error}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {renderStepIndicator()}

        <DialogFooter>
          {isSuccess ? (
            <Button type="button" onClick={handleGoToSettings}>
              {t("goToSettingsButton")}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={handleSkip}>
              {t("skipButton")}
            </Button>
          )}
        </DialogFooter>
      </>
    );
  };

  // Render current step content
  const renderStepContent = () => {
    switch (state.step) {
      case "intro":
        return renderIntroStep();
      case "platform-select":
        return renderPlatformSelectStep();
      case "migrating":
        return renderMigratingStep();
      case "complete":
        return renderCompleteStep();
      default:
        return null;
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        // Allow closing on complete step (success or failure), or via skip button
        if (!newOpen && state.step !== "complete") {
          return;
        }
        setOpen(newOpen);
      }}
    >
      <DialogContent className="sm:max-w-[500px]" showCloseButton={state.step === "complete"}>
        {renderStepContent()}
      </DialogContent>
    </Dialog>
  );
}

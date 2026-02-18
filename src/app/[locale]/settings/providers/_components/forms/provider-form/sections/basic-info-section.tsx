"use client";

import { motion } from "framer-motion";
import { ExternalLink, Eye, EyeOff, Globe, Key, Link2, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProviderEndpointsSection } from "@/app/[locale]/settings/providers/_components/provider-endpoints-table";
import { InlineWarning } from "@/components/ui/inline-warning";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { detectApiKeyWarnings } from "@/lib/utils/validation/api-key-warnings";
import type { ProviderType } from "@/types/provider";
import { UrlPreview } from "../../url-preview";
import { QuickPasteDialog } from "../components/quick-paste-dialog";
import { SectionCard, SmartInputWrapper } from "../components/section-card";
import { useProviderForm } from "../provider-form-context";

const MAX_DISPLAYED_PROVIDERS = 5;

interface BasicInfoSectionProps {
  autoUrlPending?: boolean;
  endpointPool?: {
    vendorId: number;
    providerType: ProviderType;
    hideLegacyUrlInput: boolean;
  } | null;
}

export function BasicInfoSection({ autoUrlPending, endpointPool }: BasicInfoSectionProps) {
  const t = useTranslations("settings.providers.form");
  const tBatch = useTranslations("settings.providers.batchEdit");
  const tProviders = useTranslations("settings.providers");
  const { state, dispatch, mode, provider, hideUrl, hideWebsiteUrl, batchProviders } =
    useProviderForm();
  const isEdit = mode === "edit";
  const isBatch = mode === "batch";
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [showKey, setShowKey] = useState(false);

  const apiKeyWarnings = useMemo(() => detectApiKeyWarnings(state.basic.key), [state.basic.key]);

  // Auto-focus name input (skip in batch mode)
  useEffect(() => {
    if (isBatch) return;
    const timer = setTimeout(() => {
      nameInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [isBatch]);

  // Batch mode: only isEnabled tri-state + provider summary
  if (isBatch) {
    const providers = batchProviders ?? [];
    const displayed = providers.slice(0, MAX_DISPLAYED_PROVIDERS);
    const remaining = providers.length - displayed.length;

    return (
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.2 }}
        className="space-y-6"
      >
        <SectionCard
          title={t("sections.basic.identity.title")}
          description={tBatch("dialog.editDesc", { count: providers.length })}
          icon={User}
          variant="highlight"
        >
          <div className="space-y-4">
            <SmartInputWrapper label={tBatch("fields.isEnabled.label")}>
              <Select
                value={state.batch.isEnabled}
                onValueChange={(v) =>
                  dispatch({
                    type: "SET_BATCH_IS_ENABLED",
                    payload: v as "no_change" | "true" | "false",
                  })
                }
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no_change">{tBatch("fields.isEnabled.noChange")}</SelectItem>
                  <SelectItem value="true">{tBatch("fields.isEnabled.enable")}</SelectItem>
                  <SelectItem value="false">{tBatch("fields.isEnabled.disable")}</SelectItem>
                </SelectContent>
              </Select>
            </SmartInputWrapper>

            {providers.length > 0 && (
              <div
                className="rounded-md border bg-muted/50 p-3 text-sm"
                data-testid="affected-summary"
              >
                <p className="font-medium">
                  {tBatch("affectedProviders.title")} ({providers.length})
                </p>
                <div className="mt-1 space-y-0.5 text-muted-foreground">
                  {displayed.map((p) => (
                    <p key={p.id}>
                      {p.name} ({p.maskedKey})
                    </p>
                  ))}
                  {remaining > 0 && (
                    <p className="text-xs">
                      {tBatch("affectedProviders.more", { count: remaining })}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </SectionCard>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      {/* Provider Identity */}
      <SectionCard
        title={t("sections.basic.identity.title")}
        description={t("sections.basic.identity.desc")}
        icon={User}
        variant="highlight"
        badge={!isEdit && <QuickPasteDialog disabled={state.ui.isPending} />}
      >
        <div className="space-y-4">
          <SmartInputWrapper label={t("name.label")} required>
            <div className="relative">
              <Input
                ref={nameInputRef}
                id={isEdit ? "edit-name" : "name"}
                value={state.basic.name}
                onChange={(e) => dispatch({ type: "SET_NAME", payload: e.target.value })}
                placeholder={t("name.placeholder")}
                disabled={state.ui.isPending}
                className="pr-10"
              />
              <User className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </SmartInputWrapper>
        </div>
      </SectionCard>

      {/* Website URL */}
      {!hideWebsiteUrl && (
        <SectionCard
          title={t("websiteUrl.label")}
          description={t("websiteUrl.desc")}
          icon={ExternalLink}
        >
          <SmartInputWrapper label={t("websiteUrl.label")}>
            <div className="relative">
              <Input
                id={isEdit ? "edit-website-url" : "website-url"}
                type="url"
                value={state.basic.websiteUrl}
                onChange={(e) => dispatch({ type: "SET_WEBSITE_URL", payload: e.target.value })}
                placeholder={t("websiteUrl.placeholder")}
                disabled={state.ui.isPending}
                className="pr-10"
              />
              <ExternalLink className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </SmartInputWrapper>
        </SectionCard>
      )}

      {/* Endpoint Pool */}
      {!hideUrl && endpointPool?.vendorId ? (
        <SectionCard
          title={t("sections.basic.endpointPool.title")}
          description={t("sections.basic.endpointPool.desc")}
          icon={Globe}
        >
          <div className="-mx-5 -mb-5">
            <ProviderEndpointsSection
              vendorId={endpointPool.vendorId}
              providerType={endpointPool.providerType}
              hideTypeColumn={true}
              queryKeySuffix="provider-form"
            />
          </div>
        </SectionCard>
      ) : null}

      {/* API Endpoint */}
      {!hideUrl && !endpointPool?.hideLegacyUrlInput ? (
        <SectionCard
          title={t("sections.basic.endpoint.title")}
          description={t("sections.basic.endpoint.desc")}
          icon={Link2}
        >
          <div className="space-y-4">
            <SmartInputWrapper label={t("url.label")} required>
              <div className="relative">
                <Input
                  id={isEdit ? "edit-url" : "url"}
                  value={state.basic.url}
                  onChange={(e) => dispatch({ type: "SET_URL", payload: e.target.value })}
                  placeholder={t("url.placeholder")}
                  disabled={state.ui.isPending}
                  className="pr-10 font-mono text-sm"
                />
                <Globe className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>
            </SmartInputWrapper>

            {/* URL Preview */}
            {state.basic.url.trim() && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <UrlPreview baseUrl={state.basic.url} providerType={state.routing.providerType} />
              </motion.div>
            )}
          </div>
        </SectionCard>
      ) : hideUrl ? (
        <>
          {/* No endpoints warning */}
          {!isEdit && !autoUrlPending && !state.basic.url.trim() && (
            <SectionCard variant="warning">
              <div className="text-sm font-medium">{tProviders("noEndpoints")}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {tProviders("noEndpointsDesc")}
              </div>
            </SectionCard>
          )}
          {/* Loading state */}
          {!isEdit && autoUrlPending && (
            <div className="text-xs text-muted-foreground animate-pulse">
              {tProviders("keyLoading")}
            </div>
          )}
        </>
      ) : null}

      {/* Authentication */}
      <SectionCard
        title={t("sections.basic.auth.title")}
        description={t("sections.basic.auth.desc")}
        icon={Key}
      >
        <div className="space-y-4">
          <SmartInputWrapper
            label={isEdit ? t("key.labelEdit") : t("key.label")}
            description={
              isEdit && provider ? t("key.currentKey", { key: provider.maskedKey }) : undefined
            }
            required={!isEdit}
          >
            <div className="relative">
              <Input
                id={isEdit ? "edit-key" : "key"}
                type={showKey ? "text" : "password"}
                value={state.basic.key}
                onChange={(e) => dispatch({ type: "SET_KEY", payload: e.target.value })}
                placeholder={isEdit ? t("key.leaveEmptyDesc") : t("key.placeholder")}
                disabled={state.ui.isPending}
                className="pr-10 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {apiKeyWarnings.length > 0 && (
              <div className="mt-2 space-y-1">
                {apiKeyWarnings.map((warningId) => (
                  <InlineWarning key={warningId}>{t(`key.warnings.${warningId}`)}</InlineWarning>
                ))}
              </div>
            )}
          </SmartInputWrapper>
        </div>
      </SectionCard>
    </motion.div>
  );
}

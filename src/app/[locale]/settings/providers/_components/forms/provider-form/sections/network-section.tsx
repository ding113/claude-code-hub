"use client";

import { motion } from "framer-motion";
import { Globe, Network, Shield, Wifi } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ProxyTestButton } from "../../proxy-test-button";
import { FieldGroup, SectionCard, SmartInputWrapper, ToggleRow } from "../components/section-card";
import { useProviderForm } from "../provider-form-context";

export function NetworkSection() {
  const t = useTranslations("settings.providers.form");
  const { state, dispatch, mode } = useProviderForm();
  const isEdit = mode === "edit";
  const isBatch = mode === "batch";

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      {/* Proxy Configuration */}
      <SectionCard
        title={t("sections.proxy.title")}
        description={t("sections.proxy.desc")}
        icon={Globe}
        variant="highlight"
      >
        <div className="space-y-4">
          <SmartInputWrapper
            label={t("sections.proxy.url.label")}
            description={t("sections.proxy.url.formats")}
          >
            <div className="relative">
              <Input
                id={isEdit ? "edit-proxy-url" : "proxy-url"}
                value={state.network.proxyUrl}
                onChange={(e) => dispatch({ type: "SET_PROXY_URL", payload: e.target.value })}
                placeholder={t("sections.proxy.url.placeholder")}
                disabled={state.ui.isPending}
                className="pr-10 font-mono text-sm"
                autoComplete="off"
              />
              <Network className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </SmartInputWrapper>

          {state.network.proxyUrl && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-4"
            >
              <ToggleRow
                label={t("sections.proxy.fallback.label")}
                description={t("sections.proxy.fallback.desc")}
                icon={Shield}
                iconColor="text-blue-500"
              >
                <Switch
                  id={isEdit ? "edit-proxy-fallback" : "proxy-fallback"}
                  checked={state.network.proxyFallbackToDirect}
                  onCheckedChange={(checked) =>
                    dispatch({ type: "SET_PROXY_FALLBACK_TO_DIRECT", payload: checked })
                  }
                  disabled={state.ui.isPending}
                />
              </ToggleRow>

              {/* Proxy Test - hidden in batch mode */}
              {!isBatch && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
                  <div className="flex items-center gap-3">
                    <Wifi className="h-4 w-4 text-primary" />
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">{t("sections.proxy.test.label")}</div>
                      <p className="text-xs text-muted-foreground">
                        {t("sections.proxy.test.desc")}
                      </p>
                    </div>
                  </div>
                  <ProxyTestButton
                    providerUrl={state.basic.url}
                    proxyUrl={state.network.proxyUrl}
                    proxyFallbackToDirect={state.network.proxyFallbackToDirect}
                    disabled={state.ui.isPending || !state.basic.url.trim()}
                  />
                </div>
              )}
            </motion.div>
          )}
        </div>
      </SectionCard>
    </motion.div>
  );
}

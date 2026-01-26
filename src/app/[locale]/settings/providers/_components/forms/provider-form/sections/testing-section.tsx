"use client";

import { motion } from "framer-motion";
import { FlaskConical, Globe, Link2, Plug, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { extractBaseUrl } from "@/lib/utils/validation";
import type { McpPassthroughType } from "@/types/provider";
import { ApiTestButton } from "../../api-test-button";
import { SectionCard, SmartInputWrapper } from "../components/section-card";
import { useProviderForm } from "../provider-form-context";

export function TestingSection() {
  const t = useTranslations("settings.providers.form");
  const { state, dispatch, mode, provider, enableMultiProviderTypes } = useProviderForm();
  const isEdit = mode === "edit";

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      {/* API Test */}
      <SectionCard
        title={t("sections.apiTest.title")}
        description={t("sections.apiTest.desc")}
        icon={FlaskConical}
        variant="highlight"
      >
        <div className="space-y-4">
          {/* Test Summary */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
            <Zap className="h-4 w-4 text-primary" />
            <div className="flex-1 text-xs text-muted-foreground">
              {t("sections.apiTest.summary")}
            </div>
          </div>

          {/* API Test Button */}
          <div className="p-4 rounded-lg bg-card/50 border border-border/50 space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 text-primary">
                <FlaskConical className="h-5 w-5" />
              </span>
              <div className="space-y-0.5">
                <div className="text-sm font-medium">{t("sections.apiTest.testLabel")}</div>
                <p className="text-xs text-muted-foreground">{t("sections.apiTest.desc")}</p>
              </div>
            </div>
            <ApiTestButton
              providerUrl={state.basic.url}
              apiKey={state.basic.key}
              proxyUrl={state.network.proxyUrl}
              proxyFallbackToDirect={state.network.proxyFallbackToDirect}
              providerId={isEdit ? provider?.id : undefined}
              providerType={state.routing.providerType}
              allowedModels={state.routing.allowedModels}
              enableMultiProviderTypes={enableMultiProviderTypes}
              disabled={state.ui.isPending || !state.basic.url.trim()}
            />
          </div>
        </div>
      </SectionCard>

      {/* MCP Passthrough */}
      <SectionCard
        title={t("sections.mcpPassthrough.title")}
        description={t("sections.mcpPassthrough.desc")}
        icon={Plug}
      >
        <div className="space-y-4">
          <SmartInputWrapper
            label={t("sections.mcpPassthrough.select.label")}
            description={t("sections.mcpPassthrough.hint")}
          >
            <Select
              value={state.mcp.mcpPassthroughType}
              onValueChange={(value) =>
                dispatch({ type: "SET_MCP_PASSTHROUGH_TYPE", payload: value as McpPassthroughType })
              }
              disabled={state.ui.isPending}
            >
              <SelectTrigger id={isEdit ? "edit-mcp-passthrough" : "mcp-passthrough"}>
                <SelectValue>
                  {t(`sections.mcpPassthrough.select.${state.mcp.mcpPassthroughType}.label`)}
                </SelectValue>
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
          </SmartInputWrapper>

          {/* MCP Passthrough URL - shown when not "none" */}
          {state.mcp.mcpPassthroughType !== "none" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <SmartInputWrapper
                label={t("sections.mcpPassthrough.urlLabel")}
                description={t("sections.mcpPassthrough.urlDesc")}
              >
                <div className="relative">
                  <Input
                    id={isEdit ? "edit-mcp-passthrough-url" : "mcp-passthrough-url"}
                    value={state.mcp.mcpPassthroughUrl}
                    onChange={(e) =>
                      dispatch({ type: "SET_MCP_PASSTHROUGH_URL", payload: e.target.value })
                    }
                    placeholder={t("sections.mcpPassthrough.urlPlaceholder")}
                    disabled={state.ui.isPending}
                    className="pr-10 font-mono text-sm"
                  />
                  <Link2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
                {!state.mcp.mcpPassthroughUrl && state.basic.url && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {t("sections.mcpPassthrough.urlAuto", {
                      url: extractBaseUrl(state.basic.url),
                    })}
                  </p>
                )}
              </SmartInputWrapper>
            </motion.div>
          )}

          {/* MCP Status Summary */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
            <Globe className="h-4 w-4 text-primary" />
            <div className="flex-1 text-xs text-muted-foreground">
              {state.mcp.mcpPassthroughType === "none" && t("sections.mcpPassthrough.summary.none")}
              {state.mcp.mcpPassthroughType === "minimax" &&
                t("sections.mcpPassthrough.summary.minimax")}
              {state.mcp.mcpPassthroughType === "glm" && t("sections.mcpPassthrough.summary.glm")}
              {state.mcp.mcpPassthroughType === "custom" &&
                t("sections.mcpPassthrough.summary.custom")}
            </div>
          </div>
        </div>
      </SectionCard>
    </motion.div>
  );
}

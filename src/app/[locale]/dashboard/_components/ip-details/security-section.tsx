"use client";

import { Bot, Bug, Check, Crosshair, Globe, Lock, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type React from "react";
import { Badge } from "@/components/ui/badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { cn } from "@/lib/utils/cn";
import type { IpGeoLookupResult } from "@/types/ip-geo";
import {
  asRiskLevel,
  BLOCKLIST_CATEGORY_STYLES,
  hasActiveThreatSignals,
  RiskDot,
  ScoreMeter,
  Section,
} from "./atoms";

const KNOWN_BLOCKLIST_CATEGORIES = new Set([
  "spam",
  "malware",
  "phishing",
  "scanner",
  "exploit",
  "fraud",
  "abuse",
  "other",
]);

type T = ReturnType<typeof useTranslations<"ipDetails">>;

function blocklistCategoryLabel(t: T, category: string): string {
  if (KNOWN_BLOCKLIST_CATEGORIES.has(category)) {
    return t(`blocklistCategories.${category}` as "blocklistCategories.other");
  }
  return category;
}

export function SecuritySection({ result }: { result: IpGeoLookupResult }) {
  const t = useTranslations("ipDetails");
  const { privacy, threat } = result;
  const level = asRiskLevel(threat.risk_level);
  const anyActive = hasActiveThreatSignals(privacy, threat);

  return (
    <Section
      title={t("sections.privacyThreat")}
      icon={
        anyActive ? (
          <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" />
        ) : (
          <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
        )
      }
      defaultOpen={anyActive}
      count={threat.blocklists.length > 0 ? threat.blocklists.length : undefined}
    >
      <div>
        <div className="mb-2 flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2">
            <RiskDot level={level} className="size-2.5" />
            <span className="text-sm font-medium">
              {t("fields.riskLevel")}:{" "}
              <span className="font-semibold">{t(`riskLevels.${level}` as "riskLevels.none")}</span>
            </span>
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {t("fields.score")} {threat.score.toFixed(3)}
          </span>
        </div>
        <ScoreMeter score={threat.score} level={level} showTicks className="h-2" />
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <SignalCell
          active={privacy.is_vpn}
          icon={<Lock />}
          label={t("badges.vpn")}
          description={t("privacyDesc.vpn")}
          tone="privacy"
        />
        <SignalCell
          active={privacy.is_proxy}
          icon={<Globe />}
          label={t("badges.proxy")}
          description={t("privacyDesc.proxy")}
          tone="privacy"
        />
        <SignalCell
          active={privacy.is_tor}
          icon={<Globe />}
          label={t("badges.tor")}
          description={t("privacyDesc.tor")}
          tone="privacy"
        />
        <SignalCell
          active={privacy.is_tor_exit}
          icon={<Globe />}
          label={t("badges.torExit")}
          description={t("privacyDesc.torExit")}
          tone="privacy"
        />
        <SignalCell
          active={privacy.is_relay}
          icon={<Globe />}
          label={t("badges.relay")}
          description={t("privacyDesc.relay")}
          tone="privacy"
        />
        <SignalCell
          active={threat.is_abuser}
          icon={<Bug />}
          label={t("badges.abuser")}
          description={t("threatDesc.abuser")}
          tone="threat"
        />
        <SignalCell
          active={threat.is_attacker}
          icon={<Crosshair />}
          label={t("badges.attacker")}
          description={t("threatDesc.attacker")}
          tone="threat"
        />
        <SignalCell
          active={threat.is_crawler}
          icon={<Bot />}
          label={t("badges.crawler")}
          description={t("threatDesc.crawler")}
          tone="threat"
        />
      </div>

      {threat.blocklists.length > 0 && (
        <div className="space-y-1.5">
          <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("sections.blocklists")}
          </div>
          <div className="space-y-1">
            {threat.blocklists.map((entry) => {
              const catStyle =
                BLOCKLIST_CATEGORY_STYLES[entry.category] ?? BLOCKLIST_CATEGORY_STYLES.other;
              return (
                <div
                  key={`${entry.name}-${entry.listed_at}`}
                  className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 dark:bg-muted/20"
                >
                  <span className="flex-1 truncate text-sm font-medium">{entry.name}</span>
                  <Badge variant="outline" className={cn("h-5 px-1.5 py-0 text-[11px]", catStyle)}>
                    {blocklistCategoryLabel(t, entry.category)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    <RelativeTime date={entry.listed_at} format="short" />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Section>
  );
}

function SignalCell({
  active,
  icon,
  label,
  description,
  tone,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  description: string;
  tone: "privacy" | "threat";
}) {
  const activeCls =
    tone === "threat"
      ? "border-red-500/40 bg-red-500/10 dark:bg-red-500/15"
      : "border-amber-500/40 bg-amber-500/10 dark:bg-amber-500/15";
  const iconCls = active
    ? tone === "threat"
      ? "text-red-600 dark:text-red-400"
      : "text-amber-600 dark:text-amber-400"
    : "text-muted-foreground/50";
  const labelCls = active ? "text-foreground" : "text-muted-foreground";

  return (
    <div
      className={cn(
        "flex gap-2 rounded-md border px-2.5 py-1.5",
        active ? activeCls : "bg-muted/20 dark:bg-muted/10"
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center [&>svg]:size-4",
          iconCls
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1.5">
          <span className={cn("text-xs font-semibold", labelCls)}>{label}</span>
          {active ? (
            <Check
              className={cn(
                "size-3.5",
                tone === "threat"
                  ? "text-red-600 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-400"
              )}
            />
          ) : (
            <X className="size-3.5 text-muted-foreground/50" />
          )}
        </div>
        <p className="line-clamp-2 text-[11px] text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

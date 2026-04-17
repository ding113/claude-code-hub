"use client";

import {
  Bot,
  Bug,
  Crosshair,
  Globe,
  Lock,
  MapPin,
  Network as NetworkIcon,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type React from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";
import type { IpGeoLookupResult } from "@/types/ip-geo";
import {
  asRiskLevel,
  hasActiveThreatSignals,
  NETWORK_TYPE_STYLES,
  RiskDot,
  riskClasses,
  ScoreMeter,
} from "./atoms";

const KNOWN_NETWORK_TYPES = new Set([
  "residential",
  "business",
  "mobile",
  "hosting",
  "education",
  "government",
  "military",
  "satellite",
  "unknown",
]);

const KNOWN_SUBTYPES = new Set([
  "cloud",
  "dedicated",
  "vps",
  "cdn",
  "colocation",
  "4g",
  "5g",
  "lte",
  "wisp",
]);

type T = ReturnType<typeof useTranslations<"ipDetails">>;

function networkTypeLabel(t: T, type: string): string {
  if (KNOWN_NETWORK_TYPES.has(type)) {
    return t(`networkTypes.${type}` as "networkTypes.unknown");
  }
  return type;
}

function subtypeLabel(t: T, subtype: string): string {
  if (KNOWN_SUBTYPES.has(subtype)) {
    return t(`subtypes.${subtype}` as "subtypes.cloud");
  }
  return subtype;
}

function riskLevelLabel(t: T, level: ReturnType<typeof asRiskLevel>): string {
  return t(`riskLevels.${level}` as "riskLevels.none");
}

export function IpHeroStrip({ result }: { result: IpGeoLookupResult }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <RiskHero result={result} />
      <LocationHero result={result} />
      <NetworkHero result={result} />
    </div>
  );
}

function HeroCard({
  children,
  tint,
  border,
  icon,
  label,
}: {
  children: React.ReactNode;
  tint?: string;
  border?: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 overflow-hidden rounded-lg border px-3.5 py-3",
        tint,
        border ?? "border-border"
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

function RiskHero({ result }: { result: IpGeoLookupResult }) {
  const t = useTranslations("ipDetails");
  const level = asRiskLevel(result.threat.risk_level);
  const { tint, border } = riskClasses(level);
  const { privacy, threat } = result;
  const isClean = !hasActiveThreatSignals(privacy, threat);

  return (
    <HeroCard
      tint={tint}
      border={border}
      icon={isClean ? <ShieldCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
      label={t("hero.risk")}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <RiskDot level={level} className="size-2.5" />
          <span className="text-lg font-semibold leading-tight">{riskLevelLabel(t, level)}</span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {result.threat.score.toFixed(3)}
        </span>
      </div>

      <ScoreMeter score={result.threat.score} level={level} />

      {isClean ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{t("hero.cleanHint")}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {privacy.is_vpn && <ActiveChip tone="amber" icon={<Lock />} label={t("badges.vpn")} />}
          {privacy.is_proxy && (
            <ActiveChip tone="amber" icon={<Globe />} label={t("badges.proxy")} />
          )}
          {privacy.is_tor && <ActiveChip tone="amber" icon={<Globe />} label={t("badges.tor")} />}
          {privacy.is_tor_exit && (
            <ActiveChip tone="amber" icon={<Globe />} label={t("badges.torExit")} />
          )}
          {privacy.is_relay && (
            <ActiveChip tone="amber" icon={<Globe />} label={t("badges.relay")} />
          )}
          {threat.is_abuser && <ActiveChip tone="red" icon={<Bug />} label={t("badges.abuser")} />}
          {threat.is_attacker && (
            <ActiveChip tone="red" icon={<Crosshair />} label={t("badges.attacker")} />
          )}
          {threat.is_crawler && (
            <ActiveChip tone="red" icon={<Bot />} label={t("badges.crawler")} />
          )}
        </div>
      )}
    </HeroCard>
  );
}

function ActiveChip({
  tone,
  icon,
  label,
}: {
  tone: "amber" | "red";
  icon: React.ReactNode;
  label: string;
}) {
  const cls =
    tone === "red"
      ? "bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-300"
      : "bg-amber-500/15 text-amber-800 border-amber-500/30 dark:text-amber-300";
  return (
    <Badge
      variant="outline"
      className={cn("h-5 gap-1 border px-1.5 py-0 text-[11px] [&>svg]:size-3", cls)}
    >
      {icon}
      {label}
    </Badge>
  );
}

function LocationHero({ result }: { result: IpGeoLookupResult }) {
  const t = useTranslations("ipDetails");
  const { location } = result;
  const country = location.country;
  const isUnknown = country.code === "ZZ";

  const cityRegion = [location.city, location.region?.name].filter(Boolean).join(", ");

  return (
    <HeroCard icon={<MapPin className="size-3.5" />} label={t("hero.location")}>
      {isUnknown ? (
        <div className="flex items-center gap-2">
          <Globe className="size-6 text-muted-foreground/60" />
          <span className="text-sm text-muted-foreground">{t("hero.noLocation")}</span>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <span className="text-4xl leading-none" aria-hidden="true">
            {country.flag.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-base font-semibold leading-tight">{country.name}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{country.code3}</span>
            </div>
            {cityRegion && <p className="truncate text-xs text-muted-foreground">{cityRegion}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <span className="text-[11px] text-muted-foreground">{location.continent.name}</span>
              {country.is_eu_member && (
                <Badge
                  variant="outline"
                  className="h-4 border-blue-500/30 bg-blue-500/10 px-1.5 py-0 text-[10px] text-blue-700 dark:text-blue-300"
                >
                  {t("fields.euMember")}
                </Badge>
              )}
            </div>
          </div>
        </div>
      )}
    </HeroCard>
  );
}

function NetworkHero({ result }: { result: IpGeoLookupResult }) {
  const t = useTranslations("ipDetails");
  const { connection } = result;
  const typeKey = connection.type as keyof typeof NETWORK_TYPE_STYLES;
  const typeStyle = NETWORK_TYPE_STYLES[typeKey] ?? NETWORK_TYPE_STYLES.unknown;

  return (
    <HeroCard icon={<NetworkIcon className="size-3.5" />} label={t("hero.network")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className={cn("border px-1.5 py-0 text-[11px]", typeStyle)}>
          {networkTypeLabel(t, connection.type)}
        </Badge>
        {connection.subtype && (
          <Badge variant="outline" className="h-5 px-1.5 py-0 text-[11px]">
            {subtypeLabel(t, connection.subtype)}
          </Badge>
        )}
        {connection.is_anycast && (
          <Badge
            variant="outline"
            className="h-5 border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0 text-[11px] text-cyan-700 dark:text-cyan-300"
          >
            {t("badges.anycast")}
          </Badge>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="font-mono text-base font-semibold">
          {connection.asn === null ? (
            <span className="text-muted-foreground">{t("hero.noAsn")}</span>
          ) : (
            `AS${connection.asn}`
          )}
        </span>
        {connection.handle && (
          <span className="truncate text-xs text-muted-foreground">{connection.handle}</span>
        )}
      </div>

      {connection.organization ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="truncate text-sm font-medium">{connection.organization}</p>
          </TooltipTrigger>
          <TooltipContent>{connection.organization}</TooltipContent>
        </Tooltip>
      ) : (
        <p className="text-sm text-muted-foreground">{t("hero.unknownOrg")}</p>
      )}

      {connection.domain && (
        <a
          href={`https://${connection.domain}`}
          target="_blank"
          rel="noreferrer noopener"
          className="truncate font-mono text-[11px] text-muted-foreground hover:text-primary hover:underline"
        >
          {connection.domain}
        </a>
      )}
    </HeroCard>
  );
}

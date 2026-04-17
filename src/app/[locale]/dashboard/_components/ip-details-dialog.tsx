"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useIpGeo } from "@/hooks/use-ip-geo";

interface IpDetailsDialogProps {
  ip: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const KNOWN_RISK_LEVELS = new Set(["none", "low", "medium", "high", "critical"]);

/**
 * True when the API actually located the IP. For CGN / bogon / tailscale
 * IPs upstream returns `0,0` with `accuracy_radius_km = null`, which is a
 * "we don't know" signal rather than a real pair of coordinates — hide it.
 */
export function hasMeaningfulCoordinates(coords: {
  latitude: number;
  longitude: number;
  accuracy_radius_km: number | null;
}): boolean {
  if (coords.accuracy_radius_km === null) return false;
  if (coords.latitude === 0 && coords.longitude === 0) return false;
  return true;
}

function riskLevelLabel(t: ReturnType<typeof useTranslations<"ipDetails">>, level: string): string {
  if (KNOWN_RISK_LEVELS.has(level)) {
    return t(`riskLevels.${level}` as "riskLevels.none");
  }
  // Unknown future enum value: fall back to the raw string rather than throw.
  return level;
}

function SectionRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 items-baseline gap-2 py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="col-span-2 text-sm font-medium break-all">{value}</span>
    </div>
  );
}

export function IpDetailsDialog({ ip, open, onOpenChange }: IpDetailsDialogProps) {
  const t = useTranslations("ipDetails");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <span className="font-mono">{ip ?? "—"}</span>
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {/* Only mount the content (and its useQuery) when the dialog is open.
            This keeps tests that never open the dialog free of a QueryClient
            dependency. */}
        {open && <IpDetailsContent ip={ip} t={t} />}
      </DialogContent>
    </Dialog>
  );
}

function IpDetailsContent({
  ip,
  t,
}: {
  ip: string | null;
  t: ReturnType<typeof useTranslations<"ipDetails">>;
}) {
  const { data, isLoading, isError } = useIpGeo(ip);

  return (
    <>
      {isLoading && <p className="text-sm text-muted-foreground py-4">{t("loading")}</p>}

      {isError && <p className="text-sm text-destructive py-4">{t("error")}</p>}

      {data?.status === "private" && (
        <div className="py-4">
          <Badge variant="outline">{t("privateIp")}</Badge>
          <p className="mt-2 text-sm text-muted-foreground">{t("privateIpNote")}</p>
        </div>
      )}

      {data?.status === "error" && (
        <div className="py-4">
          <p className="text-sm text-destructive">{t("error")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{data.error}</p>
        </div>
      )}

      {data?.status === "ok" && (
        <div className="space-y-4 py-2">
          <div>
            <h3 className="text-sm font-semibold mb-2">{t("sections.location")}</h3>
            <SectionRow
              label={t("fields.country")}
              value={
                <span className="inline-flex items-center gap-2">
                  <span>{data.data.location.country.flag.emoji}</span>
                  <span>
                    {data.data.location.country.name} ({data.data.location.country.code})
                  </span>
                </span>
              }
            />
            {data.data.location.region && (
              <SectionRow label={t("fields.region")} value={data.data.location.region.name} />
            )}
            {data.data.location.city && (
              <SectionRow label={t("fields.city")} value={data.data.location.city} />
            )}
            {data.data.location.postal_code && (
              <SectionRow label={t("fields.postalCode")} value={data.data.location.postal_code} />
            )}
            {hasMeaningfulCoordinates(data.data.location.coordinates) && (
              <SectionRow
                label={t("fields.coordinates")}
                value={`${data.data.location.coordinates.latitude}, ${data.data.location.coordinates.longitude}`}
              />
            )}
            <SectionRow
              label={t("fields.timezone")}
              value={`${data.data.timezone.id} (${data.data.timezone.utc_offset})`}
            />
          </div>

          <Separator />

          <div>
            <h3 className="text-sm font-semibold mb-2">{t("sections.network")}</h3>
            {data.data.connection.asn !== null && (
              <SectionRow label={t("fields.asn")} value={`AS${data.data.connection.asn}`} />
            )}
            {data.data.connection.organization && (
              <SectionRow
                label={t("fields.organization")}
                value={data.data.connection.organization}
              />
            )}
            {data.data.connection.route && (
              <SectionRow label={t("fields.route")} value={data.data.connection.route} />
            )}
            <SectionRow label={t("fields.type")} value={data.data.connection.type} />
            {data.data.connection.subtype && (
              <SectionRow label={t("fields.subtype")} value={data.data.connection.subtype} />
            )}
            {data.data.connection.rir && data.data.connection.rir !== "UNKNOWN" && (
              <SectionRow label={t("fields.rir")} value={data.data.connection.rir} />
            )}
            {data.data.connection.is_anycast && (
              <SectionRow label={t("fields.anycast")} value={t("yes")} />
            )}
            {data.data.hostname && (
              <SectionRow label={t("fields.hostname")} value={data.data.hostname} />
            )}
          </div>

          <Separator />

          <div>
            <h3 className="text-sm font-semibold mb-2">{t("sections.privacyThreat")}</h3>
            <div className="flex flex-wrap gap-2">
              {data.data.privacy.is_vpn && <Badge variant="outline">{t("badges.vpn")}</Badge>}
              {data.data.privacy.is_proxy && <Badge variant="outline">{t("badges.proxy")}</Badge>}
              {data.data.privacy.is_tor && <Badge variant="outline">{t("badges.tor")}</Badge>}
              {data.data.privacy.is_relay && <Badge variant="outline">{t("badges.relay")}</Badge>}
              {data.data.threat.is_threat && (
                <Badge variant="destructive">{t("badges.threat")}</Badge>
              )}
              {!data.data.privacy.is_anonymous && !data.data.threat.is_threat && (
                <Badge variant="secondary">{t("badges.clean")}</Badge>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("fields.riskLevel")}: {riskLevelLabel(t, data.data.threat.risk_level)} (
              {t("fields.score")} {data.data.threat.score.toFixed(3)})
            </p>
          </div>

          {data.data.abuse && (data.data.abuse.email || data.data.abuse.name) && (
            <>
              <Separator />
              <div>
                <h3 className="text-sm font-semibold mb-2">{t("sections.abuse")}</h3>
                {data.data.abuse.name && (
                  <SectionRow label={t("fields.abuseContact")} value={data.data.abuse.name} />
                )}
                {data.data.abuse.email && (
                  <SectionRow label={t("fields.email")} value={data.data.abuse.email} />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

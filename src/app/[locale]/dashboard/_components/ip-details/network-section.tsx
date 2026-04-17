"use client";

import { Building2, Network as NetworkIcon, Server, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import type { IpGeoLookupResult } from "@/types/ip-geo";
import { FieldRow, hasAny, InlineCopy, Section, SubCard } from "./atoms";

const KNOWN_COMPANY_TYPES = new Set([
  "isp",
  "hosting",
  "business",
  "education",
  "government",
  "organization",
  "unknown",
]);

const KNOWN_SCOPES = new Set([
  "public",
  "private",
  "loopback",
  "link_local",
  "multicast",
  "broadcast",
  "reserved",
  "bogon",
]);

type T = ReturnType<typeof useTranslations<"ipDetails">>;

function companyTypeLabel(t: T, type: string): string {
  if (KNOWN_COMPANY_TYPES.has(type)) {
    return t(`companyTypes.${type}` as "companyTypes.unknown");
  }
  return type;
}

function scopeLabel(t: T, scope: string): string {
  if (KNOWN_SCOPES.has(scope)) {
    return t(`scopes.${scope}` as "scopes.public");
  }
  return scope;
}

export function hasNetworkContent(result: IpGeoLookupResult): boolean {
  const { connection, company, hosting, carrier, hostname } = result;
  if (hostname) return true;
  if (connection.route || connection.handle || connection.domain) return true;
  if (connection.rir && connection.rir !== "UNKNOWN") return true;
  if (connection.scope && connection.scope !== "public") return true;
  if (hasAny(company, ["name", "domain"])) return true;
  if (hosting && hasAny(hosting, ["provider", "domain", "network"])) return true;
  if (carrier && hasAny(carrier, ["name", "mcc", "mnc"])) return true;
  return false;
}

export function NetworkSection({ result }: { result: IpGeoLookupResult }) {
  const t = useTranslations("ipDetails");
  const { connection, company, hosting, carrier, hostname } = result;

  const showRir = connection.rir && connection.rir !== "UNKNOWN";
  const showScope = connection.scope && connection.scope !== "public";

  const hasCoreConnection =
    !!hostname ||
    !!connection.route ||
    !!connection.handle ||
    !!connection.domain ||
    showRir ||
    showScope;

  const hasCompany = hasAny(company, ["name", "domain"]);
  const hasHosting = hosting !== null && hasAny(hosting, ["provider", "domain", "network"]);
  const hasCarrier = carrier !== null && hasAny(carrier, ["name", "mcc", "mnc"]);

  return (
    <Section
      title={t("sections.network")}
      icon={<NetworkIcon className="size-4 text-muted-foreground" />}
      defaultOpen
    >
      {hasCoreConnection && (
        <div className="space-y-0.5">
          {hostname && (
            <FieldRow
              label={t("fields.hostname")}
              value={<InlineCopy text={hostname}>{hostname}</InlineCopy>}
              mono
            />
          )}
          {connection.route && (
            <FieldRow
              label={t("fields.route")}
              value={<InlineCopy text={connection.route}>{connection.route}</InlineCopy>}
              mono
            />
          )}
          {connection.handle && (
            <FieldRow label={t("fields.asnHandle")} value={connection.handle} />
          )}
          {connection.domain && (
            <FieldRow
              label={t("fields.asnDomain")}
              value={
                <a
                  href={`https://${connection.domain}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary hover:underline"
                >
                  {connection.domain}
                </a>
              }
              mono
            />
          )}
          {showRir && <FieldRow label={t("fields.rir")} value={connection.rir} />}
          {showScope && (
            <FieldRow label={t("fields.scope")} value={scopeLabel(t, connection.scope)} />
          )}
        </div>
      )}

      {hasCompany && (
        <SubCard title={t("sections.company")} icon={<Building2 className="size-3.5" />}>
          <div className="space-y-0.5">
            {company.name && <FieldRow label={t("fields.companyName")} value={company.name} />}
            {company.domain && (
              <FieldRow
                label={t("fields.companyDomain")}
                value={
                  <a
                    href={`https://${company.domain}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary hover:underline"
                  >
                    {company.domain}
                  </a>
                }
                mono
              />
            )}
            {company.type && (
              <FieldRow label={t("fields.companyType")} value={companyTypeLabel(t, company.type)} />
            )}
          </div>
        </SubCard>
      )}

      {hasHosting && hosting && (
        <SubCard title={t("sections.hosting")} icon={<Server className="size-3.5" />}>
          <div className="space-y-0.5">
            {hosting.provider && (
              <FieldRow label={t("fields.hostingProvider")} value={hosting.provider} />
            )}
            {hosting.domain && (
              <FieldRow
                label={t("fields.hostingDomain")}
                value={
                  <a
                    href={`https://${hosting.domain}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary hover:underline"
                  >
                    {hosting.domain}
                  </a>
                }
                mono
              />
            )}
            {hosting.network && (
              <FieldRow
                label={t("fields.hostingNetwork")}
                value={<InlineCopy text={hosting.network}>{hosting.network}</InlineCopy>}
                mono
              />
            )}
          </div>
        </SubCard>
      )}

      {hasCarrier && carrier && (
        <SubCard title={t("sections.carrier")} icon={<Smartphone className="size-3.5" />}>
          <div className="space-y-0.5">
            {carrier.name && <FieldRow label={t("fields.carrierName")} value={carrier.name} />}
            {carrier.mcc && <FieldRow label={t("fields.mcc")} value={carrier.mcc} mono />}
            {carrier.mnc && <FieldRow label={t("fields.mnc")} value={carrier.mnc} mono />}
          </div>
        </SubCard>
      )}
    </Section>
  );
}

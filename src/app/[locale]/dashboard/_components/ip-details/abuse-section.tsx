"use client";

import { Mail, MessageSquareWarning, Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import type { IpGeoLookupResult } from "@/types/ip-geo";
import { CopyButton, FieldRow, hasAny, InlineCopy, Section } from "./atoms";

export function hasAbuseContent(result: IpGeoLookupResult): boolean {
  const { abuse } = result;
  return abuse !== null && hasAny(abuse, ["name", "email", "phone", "address"]);
}

export function AbuseSection({ result }: { result: IpGeoLookupResult }) {
  const t = useTranslations("ipDetails");
  const { abuse } = result;
  if (!abuse) return null;

  return (
    <Section
      title={t("sections.abuse")}
      icon={<MessageSquareWarning className="size-4 text-muted-foreground" />}
      defaultOpen
    >
      <div className="space-y-0.5">
        {abuse.name && <FieldRow label={t("fields.abuseName")} value={abuse.name} />}
        {abuse.email && (
          <FieldRow
            label={t("fields.abuseEmail")}
            value={
              <InlineCopy text={abuse.email}>
                <a
                  href={`mailto:${abuse.email}`}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <Mail className="size-3" />
                  {abuse.email}
                </a>
              </InlineCopy>
            }
          />
        )}
        {abuse.phone && (
          <FieldRow
            label={t("fields.abusePhone")}
            value={
              <InlineCopy text={abuse.phone}>
                <a
                  href={`tel:${abuse.phone}`}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <Phone className="size-3" />
                  <span className="font-mono">{abuse.phone}</span>
                </a>
              </InlineCopy>
            }
          />
        )}
        {abuse.address && (
          <FieldRow
            label={t("fields.abuseAddress")}
            value={
              <span className="inline-flex min-w-0 items-start gap-1.5">
                <span className="whitespace-pre-wrap">{abuse.address}</span>
                <CopyButton text={abuse.address} />
              </span>
            }
          />
        )}
      </div>
    </Section>
  );
}

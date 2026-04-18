"use client";

import { Clock, MapPin } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { IpGeoCountry, IpGeoLookupResult } from "@/types/ip-geo";
import {
  FieldRow,
  formatBigNumber,
  formatLocalTime,
  hasMeaningfulCoordinates,
  Section,
  SubCard,
} from "./atoms";
import { LocationMapCard } from "./location-map-card";

/**
 * Upstream uses these sentinel values when a country is not resolvable
 * (e.g. CGN/bogon IPs). Treating them as "has data" would render empty
 * sub-cards, so the predicates below filter them out explicitly.
 */
function hasCountryContent(country: IpGeoCountry): boolean {
  if (country.capital) return true;
  if (country.calling_code && country.calling_code !== "+0") return true;
  if (country.tld && country.tld !== ".unknown") return true;
  if (country.name_native && country.name_native !== country.name) return true;
  if (country.languages.length > 0) return true;
  if (country.currencies.length > 0) return true;
  if (country.borders.length > 0) return true;
  if (country.population > 0 || country.area_km2 > 0) return true;
  return false;
}

/**
 * Return `true` when this section has *any* non-trivial content beyond the
 * header-level "country + continent" already shown in the hero card. If
 * everything is trivial, the parent should omit the section entirely.
 */
export function hasLocationContent(result: IpGeoLookupResult): boolean {
  const { location, timezone } = result;
  if (location.country.code !== "ZZ") return true;
  if (location.region?.name) return true;
  if (location.city) return true;
  if (location.postal_code && location.postal_code !== "-") return true;
  if (hasMeaningfulCoordinates(location.coordinates)) return true;
  if (timezone?.id) return true;
  if (hasCountryContent(location.country)) return true;
  return false;
}

export function LocationSection({ result }: { result: IpGeoLookupResult }) {
  const t = useTranslations("ipDetails");
  const locale = useLocale();
  const { location, timezone } = result;
  const country = location.country;
  const isUnknownCountry = country.code === "ZZ";
  const continent = location.continent;

  const coords = hasMeaningfulCoordinates(location.coordinates)
    ? `${location.coordinates.latitude}, ${location.coordinates.longitude}`
    : null;

  const accuracy =
    location.coordinates.accuracy_radius_km !== null
      ? `± ${location.coordinates.accuracy_radius_km} km`
      : null;

  const postal = location.postal_code && location.postal_code !== "-" ? location.postal_code : null;

  // 地理层级默认展开展示；国家/时区补充信息放到下方折叠组。
  const countryName = !isUnknownCountry ? country.name : null;
  const continentName = !isUnknownCountry && continent.name !== "Unknown" ? continent.name : null;
  const regionName = location.region?.name ?? null;
  const cityName = location.city ?? null;
  const hasGeoRows =
    !!countryName || !!regionName || !!cityName || !!continentName || !!postal || !!coords;

  const hasTimezone = !!timezone?.id;
  const showCountryFields = !isUnknownCountry && hasCountryContent(country);
  const showCollapsedMeta = hasTimezone || showCountryFields;

  const nativeSuffix =
    country.name_native && country.name_native !== country.name ? country.name_native : null;
  const mapTitle = cityName ?? regionName ?? countryName ?? t("hero.location");
  const mapSubtitle = [regionName, countryName].filter(Boolean).join(" · ") || null;

  return (
    <Section
      title={t("sections.location")}
      icon={<MapPin className="size-4 text-muted-foreground" />}
      defaultOpen
    >
      {hasGeoRows && (
        <div className="space-y-0.5">
          {countryName && <FieldRow label={t("fields.country")} value={countryName} />}
          {regionName && <FieldRow label={t("fields.region")} value={regionName} />}
          {cityName && <FieldRow label={t("fields.city")} value={cityName} />}
          {continentName && <FieldRow label={t("fields.continent")} value={continentName} />}
          {postal && <FieldRow label={t("fields.postalCode")} value={postal} mono />}
          {coords && (
            <FieldRow
              label={t("fields.coordinates")}
              value={<span className="font-mono">{coords}</span>}
            />
          )}
          {accuracy && <FieldRow label={t("fields.accuracyRadius")} value={accuracy} />}
        </div>
      )}

      {coords && (
        <LocationMapCard
          latitude={location.coordinates.latitude}
          longitude={location.coordinates.longitude}
          accuracyRadiusKm={location.coordinates.accuracy_radius_km}
          title={mapTitle}
          subtitle={mapSubtitle}
        />
      )}

      {/* 用户关心的地理位置优先常驻，国家补充资料和时区一起默认折叠。 */}
      {showCollapsedMeta && (
        <SubCard
          title={t("sections.countryTimezone")}
          icon={<Clock className="size-3.5" />}
          collapsible
          defaultOpen={false}
        >
          <div className="space-y-3">
            {hasTimezone && (
              <div className="space-y-0.5">
                <FieldRow
                  label={t("fields.timezone")}
                  value={
                    <span className="inline-flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-[13px]">{timezone.id}</span>
                      {timezone.name && timezone.name !== timezone.id && (
                        <span className="text-xs text-muted-foreground">{timezone.name}</span>
                      )}
                      {timezone.abbreviation && (
                        <span className="text-xs text-muted-foreground">
                          ({timezone.abbreviation})
                        </span>
                      )}
                    </span>
                  }
                />
                <FieldRow label={t("fields.utcOffset")} value={timezone.utc_offset} mono />
                {timezone.current_time && (
                  <FieldRow
                    label={t("fields.currentTime")}
                    value={formatLocalTime(timezone.current_time, timezone.id, locale)}
                  />
                )}
                <FieldRow
                  label={t("fields.dst")}
                  value={
                    <Badge
                      variant="outline"
                      className={
                        timezone.is_dst
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          : "text-muted-foreground"
                      }
                    >
                      {timezone.is_dst ? t("misc.dstOn") : t("misc.dstOff")}
                    </Badge>
                  }
                />
              </div>
            )}

            {hasTimezone && showCountryFields && <Separator />}

            {showCountryFields && (
              <div className="space-y-0.5">
                {nativeSuffix && (
                  <FieldRow label={t("fields.countryNative")} value={nativeSuffix} />
                )}
                {country.capital && (
                  <FieldRow label={t("fields.capital")} value={country.capital} />
                )}
                {country.calling_code && country.calling_code !== "+0" && (
                  <FieldRow label={t("fields.callingCode")} value={country.calling_code} mono />
                )}
                {country.tld && country.tld !== ".unknown" && (
                  <FieldRow label={t("fields.tld")} value={country.tld} mono />
                )}
                {country.area_km2 > 0 && (
                  <FieldRow
                    label={t("fields.area")}
                    value={`${formatBigNumber(country.area_km2, locale)} ${t("misc.km2")}`}
                  />
                )}
                {country.population > 0 && (
                  <FieldRow
                    label={t("fields.population")}
                    value={formatBigNumber(country.population, locale)}
                  />
                )}
                {country.borders.length > 0 && (
                  <FieldRow
                    label={t("fields.borders")}
                    value={
                      <span className="flex flex-wrap gap-1">
                        {country.borders.map((code) => (
                          <Badge
                            key={code}
                            variant="outline"
                            className="h-5 px-1.5 py-0 font-mono text-[11px]"
                          >
                            {code}
                          </Badge>
                        ))}
                      </span>
                    }
                  />
                )}
                {country.languages.length > 0 && (
                  <FieldRow
                    label={t("fields.languages")}
                    value={
                      <span className="flex flex-wrap gap-1">
                        {country.languages.map((lang) => (
                          <Badge
                            key={lang.code}
                            variant="outline"
                            className="h-5 gap-1 px-1.5 py-0 text-[11px]"
                          >
                            <span>{lang.name_native}</span>
                            <span className="font-mono text-muted-foreground">{lang.code}</span>
                          </Badge>
                        ))}
                      </span>
                    }
                  />
                )}
                {country.currencies.length > 0 && (
                  <FieldRow
                    label={t("fields.currencies")}
                    value={
                      <span className="flex flex-wrap gap-1">
                        {country.currencies.map((cur) => (
                          <Badge
                            key={cur.code}
                            variant="outline"
                            className="h-5 gap-1 px-1.5 py-0 text-[11px]"
                          >
                            <span className="font-mono">{cur.symbol_native}</span>
                            <span className="font-mono text-muted-foreground">{cur.code}</span>
                            <span className="text-muted-foreground">· {cur.name}</span>
                          </Badge>
                        ))}
                      </span>
                    }
                  />
                )}
              </div>
            )}
          </div>
        </SubCard>
      )}
    </Section>
  );
}

export interface IpGeoContinent {
  code: string;
  name: string;
}

export interface IpGeoCoordinates {
  latitude: number;
  longitude: number;
  accuracy_radius_km: number | null;
}

export interface IpGeoFlag {
  emoji: string;
  unicode: string;
  svg: string;
  png: string;
}

export interface IpGeoLanguage {
  code: string;
  name: string;
  name_native: string;
}

export interface IpGeoCurrency {
  code: string;
  name: string;
  symbol: string;
  symbol_native: string;
  format: { decimal_separator: string; group_separator: string };
}

export interface IpGeoCountry {
  code: string;
  code3: string;
  name: string;
  name_native: string;
  capital: string | null;
  calling_code: string;
  tld: string;
  area_km2: number;
  population: number;
  borders: string[];
  is_eu_member: boolean;
  flag: IpGeoFlag;
  languages: IpGeoLanguage[];
  currencies: IpGeoCurrency[];
}

export interface IpGeoRegion {
  code: string;
  name: string;
  type: string;
}

export interface IpGeoLocation {
  continent: IpGeoContinent;
  country: IpGeoCountry;
  region: IpGeoRegion | null;
  city: string | null;
  postal_code: string | null;
  coordinates: IpGeoCoordinates;
}

export interface IpGeoTimezone {
  id: string;
  name: string;
  abbreviation: string;
  utc_offset: string;
  utc_offset_seconds: number;
  is_dst: boolean;
  current_time: string;
}

export interface IpGeoConnection {
  asn: number;
  handle: string | null;
  organization: string | null;
  domain: string | null;
  route: string;
  rir: string;
  type: string;
  subtype: string | null;
  scope: string;
  is_anycast: boolean;
}

export interface IpGeoCompany {
  name: string | null;
  domain: string | null;
  type: string;
}

export interface IpGeoCarrier {
  name: string | null;
  mcc: string | null;
  mnc: string | null;
}

export interface IpGeoHosting {
  provider: string | null;
  domain: string | null;
  network: string | null;
}

export interface IpGeoPrivacy {
  is_proxy: boolean;
  is_vpn: boolean;
  is_tor: boolean;
  is_tor_exit: boolean;
  is_relay: boolean;
  is_anonymous: boolean;
}

export interface IpGeoThreat {
  is_abuser: boolean;
  is_attacker: boolean;
  is_crawler: boolean;
  is_threat: boolean;
  score: number;
  risk_level: "none" | "low" | "medium" | "high" | "critical";
  blocklists: Array<{ name: string; category: string; listed_at: string }>;
}

export interface IpGeoAbuse {
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}

export interface IpGeoLookupResult {
  ip: string;
  version: "ipv4" | "ipv6";
  hostname: string | null;
  location: IpGeoLocation;
  timezone: IpGeoTimezone;
  connection: IpGeoConnection;
  company: IpGeoCompany;
  carrier: IpGeoCarrier | null;
  hosting: IpGeoHosting | null;
  privacy: IpGeoPrivacy;
  threat: IpGeoThreat;
  abuse: IpGeoAbuse | null;
}

/** Synthetic marker returned for private/loopback/bogon IPs (we never query upstream for these). */
export interface IpGeoPrivateMarker {
  ip: string;
  kind: "private";
}

export type IpGeoLookupResponse =
  | { status: "ok"; data: IpGeoLookupResult }
  | { status: "private"; data: IpGeoPrivateMarker }
  | { status: "error"; error: string };

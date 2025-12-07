export type CacheTtlPreference = "inherit" | "5m" | "1h";

export type CacheTtlResolved = Exclude<CacheTtlPreference, "inherit">;

export type CacheTtlApplied = CacheTtlResolved | "mixed";

export type XffPick =
  | "leftmost"
  | "rightmost"
  | { kind: "index"; index: number };

export interface IpHeaderRule {
  name: string;
  pick?: XffPick;
}

export interface IpExtractionConfig {
  headers: IpHeaderRule[];
}

export const DEFAULT_IP_EXTRACTION_CONFIG: IpExtractionConfig = {
  headers: [
    { name: "cf-connecting-ip" },
    { name: "x-real-ip" },
    { name: "x-forwarded-for", pick: "rightmost" },
  ],
};

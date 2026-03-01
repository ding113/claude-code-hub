export interface ClientRestrictionPresetOption {
  value: string;
  aliases: readonly string[];
}

const CLAUDE_CODE_ALIAS_VALUES = [
  "claude-code",
  "claude-code-cli",
  "claude-code-cli-sdk",
  "claude-code-vscode",
  "claude-code-sdk-ts",
  "claude-code-sdk-py",
  "claude-code-gh-action",
] as const;

export const CLIENT_RESTRICTION_PRESET_OPTIONS: readonly ClientRestrictionPresetOption[] = [
  { value: "claude-code", aliases: CLAUDE_CODE_ALIAS_VALUES },
  { value: "gemini-cli", aliases: ["gemini-cli"] },
  { value: "factory-cli", aliases: ["factory-cli"] },
  { value: "codex-cli", aliases: ["codex-cli"] },
];

const PRESET_OPTION_MAP = new Map(
  CLIENT_RESTRICTION_PRESET_OPTIONS.map((option) => [option.value, option] as const)
);

const PRESET_ALIAS_SET = new Set(
  CLIENT_RESTRICTION_PRESET_OPTIONS.flatMap((option) => [...option.aliases])
);

function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function getPresetAliases(presetValue: string): readonly string[] {
  return PRESET_OPTION_MAP.get(presetValue)?.aliases ?? [presetValue];
}

export function isPresetClientValue(value: string): boolean {
  return PRESET_ALIAS_SET.has(value);
}

export function isPresetSelected(values: string[], presetValue: string): boolean {
  const aliases = getPresetAliases(presetValue);
  return values.some((value) => aliases.includes(value));
}

export function removePresetValues(values: string[], presetValue: string): string[] {
  const aliases = new Set(getPresetAliases(presetValue));
  return values.filter((value) => !aliases.has(value));
}

export function togglePresetSelection(
  values: string[],
  presetValue: string,
  checked: boolean
): string[] {
  if (!checked) {
    return removePresetValues(values, presetValue);
  }

  if (isPresetSelected(values, presetValue)) {
    return uniqueOrdered(values);
  }

  return uniqueOrdered([...values, presetValue]);
}

export function splitPresetAndCustomClients(values: string[]): {
  presetValues: string[];
  customValues: string[];
} {
  const presetValues = values.filter((value) => PRESET_ALIAS_SET.has(value));
  const customValues = values.filter((value) => !PRESET_ALIAS_SET.has(value));
  return { presetValues, customValues };
}

export function mergePresetAndCustomClients(values: string[], customValues: string[]): string[] {
  const { presetValues } = splitPresetAndCustomClients(values);
  const filteredCustomValues = customValues.filter((value) => !PRESET_ALIAS_SET.has(value));
  return uniqueOrdered([...presetValues, ...filteredCustomValues]);
}

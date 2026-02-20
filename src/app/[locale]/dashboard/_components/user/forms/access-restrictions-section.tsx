"use client";

import { Shield } from "lucide-react";
import { useCallback, useMemo } from "react";
import { ArrayTagInputField } from "@/components/form/form-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

// Claude Code builtin sub-clients (must match BUILTIN_CLIENT_KEYWORDS in client-detector.ts)
const CLAUDE_CODE_CLIENTS = [
  { value: "claude-code", isParent: true },
  { value: "claude-code-cli", isParent: false },
  { value: "claude-code-cli-sdk", isParent: false },
  { value: "claude-code-vscode", isParent: false },
  { value: "claude-code-sdk-ts", isParent: false },
  { value: "claude-code-sdk-py", isParent: false },
  { value: "claude-code-gh-action", isParent: false },
];

// Other preset clients (non-Claude Code)
const OTHER_PRESET_CLIENTS = [
  { value: "gemini-cli" },
  { value: "factory-cli" },
  { value: "codex-cli" },
];

const ALL_PRESET_VALUES = new Set([
  ...CLAUDE_CODE_CLIENTS.map((c) => c.value),
  ...OTHER_PRESET_CLIENTS.map((c) => c.value),
]);

// Model name validation pattern
const MODEL_NAME_PATTERN = /^[a-zA-Z0-9._:/-]+$/;

export interface AccessRestrictionsSectionProps {
  allowedClients: string[];
  blockedClients: string[];
  allowedModels: string[];
  modelSuggestions: string[];
  onChange: (field: "allowedClients" | "blockedClients" | "allowedModels", value: string[]) => void;
  translations: {
    sections: {
      accessRestrictions: string;
    };
    fields: {
      allowedClients: {
        label: string;
        description: string;
        customLabel: string;
        customPlaceholder: string;
      };
      blockedClients: {
        label: string;
        description: string;
        customLabel: string;
        customPlaceholder: string;
      };
      allowedModels: {
        label: string;
        placeholder: string;
        description: string;
      };
    };
    presetClients: Record<string, string>;
  };
}

export function AccessRestrictionsSection({
  allowedClients,
  blockedClients,
  allowedModels,
  modelSuggestions,
  onChange,
  translations,
}: AccessRestrictionsSectionProps) {
  const allowed = allowedClients || [];
  const blocked = blockedClients || [];

  const { presetAllowed, customAllowed } = useMemo(() => {
    const preset = allowed.filter((c) => ALL_PRESET_VALUES.has(c));
    const custom = allowed.filter((c) => !ALL_PRESET_VALUES.has(c));
    return { presetAllowed: preset, customAllowed: custom };
  }, [allowed]);

  const { presetBlocked, customBlocked } = useMemo(() => {
    const preset = blocked.filter((c) => ALL_PRESET_VALUES.has(c));
    const custom = blocked.filter((c) => !ALL_PRESET_VALUES.has(c));
    return { presetBlocked: preset, customBlocked: custom };
  }, [blocked]);

  const handleAllowToggle = (clientValue: string, checked: boolean) => {
    if (checked) {
      onChange("allowedClients", [...allowed.filter((c) => c !== clientValue), clientValue]);
      onChange(
        "blockedClients",
        blocked.filter((c) => c !== clientValue)
      );
    } else {
      onChange(
        "allowedClients",
        allowed.filter((c) => c !== clientValue)
      );
    }
  };

  const handleBlockToggle = (clientValue: string, checked: boolean) => {
    if (checked) {
      onChange("blockedClients", [...blocked.filter((c) => c !== clientValue), clientValue]);
      onChange(
        "allowedClients",
        allowed.filter((c) => c !== clientValue)
      );
    } else {
      onChange(
        "blockedClients",
        blocked.filter((c) => c !== clientValue)
      );
    }
  };

  const handleCustomAllowedChange = (newCustom: string[]) => {
    onChange("allowedClients", [...presetAllowed, ...newCustom]);
  };

  const handleCustomBlockedChange = (newCustom: string[]) => {
    onChange("blockedClients", [...presetBlocked, ...newCustom]);
  };

  const validateModelTag = useCallback(
    (tag: string): boolean => {
      if (!tag || tag.trim().length === 0) return false;
      if (tag.length > 64) return false;
      if (!MODEL_NAME_PATTERN.test(tag)) return false;
      if (allowedModels.includes(tag)) return false;
      if (allowedModels.length >= 50) return false;
      return true;
    },
    [allowedModels]
  );

  const renderPresetRow = (value: string, indent: boolean) => {
    const isAllowed = allowed.includes(value);
    const isBlocked = blocked.includes(value);
    const displayLabel = translations.presetClients[value] ?? value;

    return (
      <div key={value} className={`flex items-center gap-4 py-1 ${indent ? "pl-6" : ""}`}>
        <span className="text-sm flex-1 text-foreground">{displayLabel}</span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Checkbox
              id={`allow-${value}`}
              checked={isAllowed}
              onCheckedChange={(checked) => handleAllowToggle(value, checked === true)}
            />
            <Label
              htmlFor={`allow-${value}`}
              className="text-xs font-normal cursor-pointer text-muted-foreground"
            >
              Allow
            </Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Checkbox
              id={`block-${value}`}
              checked={isBlocked}
              onCheckedChange={(checked) => handleBlockToggle(value, checked === true)}
            />
            <Label
              htmlFor={`block-${value}`}
              className="text-xs font-normal cursor-pointer text-muted-foreground"
            >
              Block
            </Label>
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Shield className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">{translations.sections.accessRestrictions}</h3>
      </div>

      {/* Client Restrictions */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium mb-1">{translations.fields.allowedClients.label}</p>
          <p className="text-xs text-muted-foreground mb-2">
            {translations.fields.allowedClients.description}
          </p>
        </div>

        {/* Claude Code group */}
        <div className="space-y-0.5 border rounded-md p-2">
          {CLAUDE_CODE_CLIENTS.map((client) => renderPresetRow(client.value, !client.isParent))}
        </div>

        {/* Other presets */}
        <div className="space-y-0.5">
          {OTHER_PRESET_CLIENTS.map((client) => renderPresetRow(client.value, false))}
        </div>

        {/* Custom allowed patterns */}
        <ArrayTagInputField
          label={translations.fields.allowedClients.customLabel}
          maxTagLength={64}
          maxTags={50}
          placeholder={translations.fields.allowedClients.customPlaceholder}
          value={customAllowed}
          onChange={handleCustomAllowedChange}
        />

        {/* Custom blocked patterns */}
        <ArrayTagInputField
          label={translations.fields.blockedClients.customLabel}
          maxTagLength={64}
          maxTags={50}
          placeholder={translations.fields.blockedClients.customPlaceholder}
          value={customBlocked}
          onChange={handleCustomBlockedChange}
        />
      </div>

      {/* Allowed Models (AI model restrictions) */}
      <ArrayTagInputField
        label={translations.fields.allowedModels.label}
        maxTagLength={64}
        maxTags={50}
        placeholder={translations.fields.allowedModels.placeholder}
        description={translations.fields.allowedModels.description}
        value={allowedModels || []}
        onChange={(value) => onChange("allowedModels", value)}
        suggestions={modelSuggestions}
        validateTag={validateModelTag}
      />
    </section>
  );
}

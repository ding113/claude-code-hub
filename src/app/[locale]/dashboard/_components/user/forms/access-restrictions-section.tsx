"use client";

import { Shield } from "lucide-react";
import { useCallback, useMemo } from "react";
import { ArrayTagInputField } from "@/components/form/form-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

// Preset client patterns
const PRESET_CLIENTS = [
  { value: "claude-cli", label: "Claude Code CLI" },
  { value: "gemini-cli", label: "Gemini CLI" },
  { value: "factory-cli", label: "Droid CLI" },
  { value: "codex-cli", label: "Codex CLI" },
];

// Model name validation pattern: allows alphanumeric, dots, colons, slashes, underscores, hyphens
// Examples: gemini-1.5-pro, gpt-4.1, claude-3-opus-20240229, o1-mini
const MODEL_NAME_PATTERN = /^[a-zA-Z0-9._:/-]+$/;

export interface AccessRestrictionsSectionProps {
  allowedClients: string[];
  allowedModels: string[];
  modelSuggestions: string[];
  onChange: (field: "allowedClients" | "allowedModels", value: string[]) => void;
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
  allowedModels,
  modelSuggestions,
  onChange,
  translations,
}: AccessRestrictionsSectionProps) {
  // Separate preset clients from custom clients
  const { presetSelected, customClients } = useMemo(() => {
    const presetValues = PRESET_CLIENTS.map((p) => p.value);
    const preset = (allowedClients || []).filter((c) => presetValues.includes(c));
    const custom = (allowedClients || []).filter((c) => !presetValues.includes(c));
    return { presetSelected: preset, customClients: custom };
  }, [allowedClients]);

  const handlePresetChange = (clientValue: string, checked: boolean) => {
    const currentClients = allowedClients || [];
    if (checked) {
      onChange("allowedClients", [...currentClients, clientValue]);
    } else {
      onChange(
        "allowedClients",
        currentClients.filter((c) => c !== clientValue)
      );
    }
  };

  const handleCustomClientsChange = (newCustomClients: string[]) => {
    // Merge preset clients with new custom clients
    onChange("allowedClients", [...presetSelected, ...newCustomClients]);
  };

  // Custom validation for model names (allows dots, colons, slashes)
  const validateModelTag = useCallback(
    (tag: string): boolean => {
      if (!tag || tag.trim().length === 0) return false;
      if (tag.length > 64) return false;
      if (!MODEL_NAME_PATTERN.test(tag)) return false;
      if (allowedModels.includes(tag)) return false; // duplicate check
      if (allowedModels.length >= 50) return false; // max tags check
      return true;
    },
    [allowedModels]
  );

  return (
    <section className="rounded-lg border border-border bg-card/50 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h4 className="text-sm font-semibold">{translations.sections.accessRestrictions}</h4>
      </div>

      {/* Allowed Clients (CLI/IDE restrictions) */}
      <div className="space-y-3">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">{translations.fields.allowedClients.label}</Label>
          <p className="text-xs text-muted-foreground">
            {translations.fields.allowedClients.description}
          </p>
        </div>

        {/* Preset client checkboxes in 2x2 grid */}
        <div className="grid grid-cols-2 gap-2">
          {PRESET_CLIENTS.map((client) => {
            const isChecked = presetSelected.includes(client.value);
            const displayLabel = translations.presetClients[client.value] || client.label;
            return (
              <div key={client.value} className="flex items-center space-x-2">
                <Checkbox
                  id={`client-${client.value}`}
                  checked={isChecked}
                  onCheckedChange={(checked) => handlePresetChange(client.value, checked === true)}
                />
                <Label
                  htmlFor={`client-${client.value}`}
                  className="text-sm font-normal cursor-pointer"
                >
                  {displayLabel}
                </Label>
              </div>
            );
          })}
        </div>

        {/* Custom client patterns */}
        <ArrayTagInputField
          label={translations.fields.allowedClients.customLabel}
          maxTagLength={64}
          maxTags={50}
          placeholder={translations.fields.allowedClients.customPlaceholder}
          value={customClients}
          onChange={handleCustomClientsChange}
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

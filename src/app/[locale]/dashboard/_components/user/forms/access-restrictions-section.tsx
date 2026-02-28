"use client";

import { Shield } from "lucide-react";
import { useCallback, useMemo } from "react";
import { ArrayTagInputField } from "@/components/form/form-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  CLIENT_RESTRICTION_PRESET_OPTIONS,
  isPresetSelected,
  mergePresetAndCustomClients,
  removePresetValues,
  splitPresetAndCustomClients,
  togglePresetSelection,
} from "@/lib/client-restrictions/client-presets";

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
        customHelp: string;
      };
      blockedClients: {
        label: string;
        description: string;
        customLabel: string;
        customPlaceholder: string;
        customHelp: string;
      };
      allowedModels: {
        label: string;
        placeholder: string;
        description: string;
      };
    };
    actions: {
      allow: string;
      block: string;
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

  const { customValues: customAllowed } = useMemo(
    () => splitPresetAndCustomClients(allowed),
    [allowed]
  );

  const { customValues: customBlocked } = useMemo(
    () => splitPresetAndCustomClients(blocked),
    [blocked]
  );

  const handleAllowToggle = (presetValue: string, checked: boolean) => {
    onChange("allowedClients", togglePresetSelection(allowed, presetValue, checked));
    if (checked) {
      onChange("blockedClients", removePresetValues(blocked, presetValue));
    }
  };

  const handleBlockToggle = (presetValue: string, checked: boolean) => {
    onChange("blockedClients", togglePresetSelection(blocked, presetValue, checked));
    if (checked) {
      onChange("allowedClients", removePresetValues(allowed, presetValue));
    }
  };

  const handleCustomAllowedChange = (newCustom: string[]) => {
    onChange("allowedClients", mergePresetAndCustomClients(allowed, newCustom));
  };

  const handleCustomBlockedChange = (newCustom: string[]) => {
    onChange("blockedClients", mergePresetAndCustomClients(blocked, newCustom));
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

  const renderPresetRow = (value: string) => {
    const isAllowed = isPresetSelected(allowed, value);
    const isBlocked = isPresetSelected(blocked, value);
    const displayLabel = translations.presetClients[value] ?? value;

    return (
      <div key={value} className="flex items-center gap-4 py-1">
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
              {translations.actions.allow}
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
              {translations.actions.block}
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

        <div className="space-y-0.5 border rounded-md p-2">
          {CLIENT_RESTRICTION_PRESET_OPTIONS.map((client) => renderPresetRow(client.value))}
        </div>

        {/* Custom allowed patterns */}
        <ArrayTagInputField
          label={translations.fields.allowedClients.customLabel}
          description={translations.fields.allowedClients.customHelp}
          maxTagLength={64}
          maxTags={50}
          placeholder={translations.fields.allowedClients.customPlaceholder}
          value={customAllowed}
          onChange={handleCustomAllowedChange}
        />

        {/* Custom blocked patterns */}
        <ArrayTagInputField
          label={translations.fields.blockedClients.customLabel}
          description={translations.fields.blockedClients.customHelp}
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

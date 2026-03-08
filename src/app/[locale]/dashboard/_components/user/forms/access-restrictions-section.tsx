"use client";

import { Shield } from "lucide-react";
import { useCallback } from "react";
import { ClientRestrictionsEditor } from "@/components/form/client-restrictions-editor";
import { ArrayTagInputField } from "@/components/form/form-field";

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
    subClients?: Record<string, string>;
    nSelected?: string;
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

        <ClientRestrictionsEditor
          allowed={allowed}
          blocked={blocked}
          onAllowedChange={(next) => onChange("allowedClients", next)}
          onBlockedChange={(next) => onChange("blockedClients", next)}
          translations={{
            allowAction: translations.actions.allow,
            blockAction: translations.actions.block,
            customAllowedLabel: translations.fields.allowedClients.customLabel,
            customAllowedPlaceholder: translations.fields.allowedClients.customPlaceholder,
            customBlockedLabel: translations.fields.blockedClients.customLabel,
            customBlockedPlaceholder: translations.fields.blockedClients.customPlaceholder,
            customHelp: translations.fields.allowedClients.customHelp,
            presetClients: translations.presetClients,
            subClients: translations.subClients,
            nSelected: translations.nSelected,
          }}
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

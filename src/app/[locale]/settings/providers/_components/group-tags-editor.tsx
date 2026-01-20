"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TagInput } from "@/components/ui/tag-input";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { getContrastTextColor, getGroupColor } from "@/lib/utils/color";

const GROUP_TAG_MAX_TOTAL_LENGTH = 50;

interface GroupTagsEditorProps {
  value: string;
  onSave: (value: string) => Promise<boolean>;
  disabled?: boolean;
  suggestions?: string[];
}

export function GroupTagsEditor({
  value,
  onSave,
  disabled,
  suggestions = [],
}: GroupTagsEditorProps) {
  const t = useTranslations("settings.providers.groupEditor");
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      const parsed = value
        ? value
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
      setTags(parsed);
    }
  };

  const handleSave = async () => {
    const serialized = tags.join(",");

    if (serialized.length > GROUP_TAG_MAX_TOTAL_LENGTH) {
      return;
    }

    setSaving(true);
    const success = await onSave(serialized);
    setSaving(false);
    if (success) {
      setOpen(false);
    }
  };

  const displayTags = value
    ? value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <div
          className="flex items-center gap-1 flex-wrap cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5 -mx-1 -my-0.5 transition-colors"
          role="button"
          tabIndex={disabled ? -1 : 0}
        >
          {displayTags.length > 0 ? (
            displayTags.map((tag, index) => {
              const bgColor = getGroupColor(tag);
              return (
                <Badge
                  key={`${tag}-${index}`}
                  className="flex-shrink-0 text-xs pointer-events-none"
                  style={{
                    backgroundColor: bgColor,
                    color: getContrastTextColor(bgColor),
                  }}
                >
                  {tag}
                </Badge>
              );
            })
          ) : (
            <Badge variant="outline" className="flex-shrink-0 pointer-events-none">
              {PROVIDER_GROUP.DEFAULT}
            </Badge>
          )}
        </div>
      </PopoverTrigger>

      <PopoverContent className="w-80 p-3" align="start">
        <div className="space-y-3">
          <div className="text-sm font-medium">{t("title")}</div>

          <TagInput
            value={tags}
            onChange={setTags}
            placeholder={t("placeholder")}
            suggestions={suggestions}
            maxTagLength={50}
            maxTags={20}
            disabled={saving}
            onInvalidTag={(tag, reason) => {
              const messages: Record<string, string> = {
                empty: "标签不能为空",
                duplicate: "标签重复",
                too_long: `标签长度不能超过 50 字符`,
                invalid_format: "标签格式无效",
                max_tags: "标签数量已达上限",
              };
              console.warn(`Invalid tag: ${tag}, reason: ${reason}`);
            }}
          />

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : t("save")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

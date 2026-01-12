"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { addKey } from "@/actions/keys";
import { createUserOnly, removeUser } from "@/actions/users";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { useZodForm } from "@/lib/hooks/use-zod-form";
import { KeyFormSchema, UpdateUserSchema } from "@/lib/validation/schemas";
import { KeyEditSection } from "./forms/key-edit-section";
import { UserEditSection } from "./forms/user-edit-section";
import { useKeyTranslations } from "./hooks/use-key-translations";
import { useModelSuggestions } from "./hooks/use-model-suggestions";
import { useUserTranslations } from "./hooks/use-user-translations";
import { getFirstErrorMessage } from "./utils/form-utils";
import { normalizeProviderGroup } from "./utils/provider-group";

export interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const CreateUserSchema = UpdateUserSchema.extend({
  name: z.string().min(1).max(64),
  providerGroup: z.string().max(200).nullable().optional(),
  allowedClients: z.array(z.string().max(64)).max(50).optional().default([]),
  allowedModels: z.array(z.string().max(64)).max(50).optional().default([]),
  dailyQuota: z.number().nullable().optional(),
});

const CreateKeySchema = KeyFormSchema.extend({
  id: z.number(),
  isEnabled: z.boolean().optional(),
  // 覆盖 expiresAt 以支持 Date 类型（KeyEditSection 返回 Date 对象）
  expiresAt: z
    .union([z.date(), z.string(), z.null(), z.undefined()])
    .optional()
    .transform((val) => {
      if (val === null || val === undefined || val === "") return undefined;
      if (val instanceof Date) return val.toISOString();
      return val;
    }),
});

const CreateFormSchema = z.object({
  user: CreateUserSchema,
  key: CreateKeySchema,
});

type CreateFormValues = z.infer<typeof CreateFormSchema>;

function getNextTempKeyId() {
  return -Math.floor(Date.now() + Math.random() * 1000);
}

function buildDefaultValues(): CreateFormValues {
  return {
    user: {
      name: "",
      note: "",
      tags: [],
      expiresAt: undefined,
      providerGroup: PROVIDER_GROUP.DEFAULT,
      rpm: 0,
      limit5hUsd: null,
      dailyQuota: null,
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
      limitConcurrentSessions: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      allowedClients: [],
      allowedModels: [],
    },
    key: {
      id: getNextTempKeyId(),
      name: "default",
      isEnabled: true,
      expiresAt: undefined,
      canLoginWebUi: false,
      providerGroup: PROVIDER_GROUP.DEFAULT,
      cacheTtlPreference: "inherit" as const,
      limit5hUsd: null,
      limitDailyUsd: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
      limitConcurrentSessions: 0,
    },
  };
}

interface GeneratedKeyInfo {
  generatedKey: string;
  keyName: string;
  userName: string;
}

function CreateUserDialogInner({ onOpenChange, onSuccess }: CreateUserDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("dashboard.userManagement");
  const tCommon = useTranslations("common");
  const [isPending, startTransition] = useTransition();
  const [generatedKey, setGeneratedKey] = useState<GeneratedKeyInfo | null>(null);
  const [copied, setCopied] = useState(false);

  // Use shared hooks
  const modelSuggestions = useModelSuggestions(PROVIDER_GROUP.DEFAULT);
  const userEditTranslations = useUserTranslations({ showProviderGroup: false });
  const keyEditTranslations = useKeyTranslations();

  const defaultValues = useMemo(() => buildDefaultValues(), []);

  const form = useZodForm({
    schema: CreateFormSchema,
    defaultValues,
    onSubmit: async (data) => {
      startTransition(async () => {
        try {
          // Create user first
          const userRes = await createUserOnly({
            name: data.user.name,
            note: data.user.note,
            tags: data.user.tags,
            expiresAt: data.user.expiresAt ?? null,
            rpm: data.user.rpm,
            limit5hUsd: data.user.limit5hUsd,
            dailyQuota: data.user.dailyQuota ?? undefined,
            limitWeeklyUsd: data.user.limitWeeklyUsd,
            limitMonthlyUsd: data.user.limitMonthlyUsd,
            limitTotalUsd: data.user.limitTotalUsd,
            limitConcurrentSessions: data.user.limitConcurrentSessions,
            dailyResetMode: data.user.dailyResetMode,
            dailyResetTime: data.user.dailyResetTime,
            allowedClients: data.user.allowedClients,
            allowedModels: data.user.allowedModels,
          });
          if (!userRes.ok) {
            toast.error(userRes.error || t("createDialog.saveFailed"));
            return;
          }

          const newUserId = userRes.data.user.id;

          // Create the first key
          const keyRes = await addKey({
            userId: newUserId,
            name: data.key.name,
            // 重要：清除到期时间时用空字符串表达，避免 undefined 在 Server Action 序列化时被丢弃
            expiresAt: data.key.expiresAt ?? "",
            canLoginWebUi: data.key.canLoginWebUi,
            providerGroup: normalizeProviderGroup(data.key.providerGroup),
            cacheTtlPreference: data.key.cacheTtlPreference,
            limit5hUsd: data.key.limit5hUsd,
            limitDailyUsd: data.key.limitDailyUsd,
            dailyResetMode: data.key.dailyResetMode,
            dailyResetTime: data.key.dailyResetTime,
            limitWeeklyUsd: data.key.limitWeeklyUsd,
            limitMonthlyUsd: data.key.limitMonthlyUsd,
            limitTotalUsd: data.key.limitTotalUsd,
            limitConcurrentSessions: data.key.limitConcurrentSessions,
          });

          if (!keyRes.ok) {
            // Rollback: delete the user since key creation failed
            let rollbackFailed = false;
            try {
              await removeUser(newUserId);
            } catch (rollbackError) {
              rollbackFailed = true;
              console.error("[CreateUserDialog] rollback failed", rollbackError);
            }
            toast.error(keyRes.error || t("createDialog.keyCreateFailed", { name: data.key.name }));
            if (rollbackFailed) {
              toast.error(t("createDialog.rollbackFailed", { userId: newUserId }));
            }
            return;
          }

          // Show generated key
          setGeneratedKey({
            generatedKey: keyRes.data?.generatedKey || "",
            keyName: data.key.name,
            userName: data.user.name,
          });

          onSuccess?.();
          queryClient.invalidateQueries({ queryKey: ["users"] });
          router.refresh();
        } catch (error) {
          console.error("[CreateUserDialog] submit failed", error);
          toast.error(t("createDialog.saveFailed"));
        }
      });
    },
  });

  const errorMessage = useMemo(() => getFirstErrorMessage(form.errors), [form.errors]);

  const currentUserDraft = form.values.user || defaultValues.user;
  const currentKeyDraft = form.values.key || defaultValues.key;

  const handleUserChange = (field: string | Record<string, any>, value?: any) => {
    const prev = form.values.user || defaultValues.user;
    const next = { ...prev };

    if (typeof field === "object") {
      Object.entries(field).forEach(([key, val]) => {
        const mappedField = key === "description" ? "note" : key;
        (next as any)[mappedField] = mappedField === "expiresAt" ? (val ?? undefined) : val;
      });
    } else {
      const mappedField = field === "description" ? "note" : field;
      if (mappedField === "expiresAt") {
        (next as any)[mappedField] = value ?? undefined;
      } else {
        (next as any)[mappedField] = value;
      }
    }

    // 直接替换整个 user 对象，因为 useZodForm.setValue 不支持嵌套路径
    form.setValue("user" as any, next);
  };

  const handleKeyChange = (field: string | Record<string, any>, value?: any) => {
    const prev = form.values.key || defaultValues.key;
    const next = { ...prev };

    if (typeof field === "object") {
      Object.entries(field).forEach(([key, val]) => {
        (next as any)[key] = key === "expiresAt" ? (val ?? undefined) : val;
      });
    } else {
      if (field === "expiresAt") {
        (next as any)[field] = value ?? undefined;
      } else {
        (next as any)[field] = value;
      }
    }

    // 直接替换整个 key 对象，因为 useZodForm.setValue 不支持嵌套路径
    form.setValue("key" as any, next);
  };

  const handleCopy = async () => {
    if (!generatedKey) return;
    try {
      await navigator.clipboard.writeText(generatedKey.generatedKey);
      setCopied(true);
      toast.success(tCommon("copySuccess"));
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("[CreateUserDialog] copy failed", error);
      toast.error(tCommon("copyFailed"));
    }
  };

  const handleClose = () => {
    setGeneratedKey(null);
    setCopied(false);
    onOpenChange(false);
  };

  // Show generated key result
  if (generatedKey) {
    return (
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" aria-hidden="true" />
            <DialogTitle>{t("createDialog.successTitle")}</DialogTitle>
          </div>
          <DialogDescription>{t("createDialog.successDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{t("userEditSection.fields.username.label")}</Label>
            <Input value={generatedKey.userName} readOnly className="bg-muted" />
          </div>
          <div className="space-y-2">
            <Label>{t("keyEditSection.fields.keyName.label")}</Label>
            <Input value={generatedKey.keyName} readOnly className="bg-muted" />
          </div>
          <div className="space-y-2">
            <Label>{t("createDialog.generatedKey")}</Label>
            <div className="flex items-center gap-2">
              <Input value={generatedKey.generatedKey} readOnly className="font-mono bg-muted" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleCopy}
                className="shrink-0"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("createDialog.keyHint")}</p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={handleClose}>
            {tCommon("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="w-full max-w-[95vw] sm:max-w-[85vw] md:max-w-[70vw] lg:max-w-3xl max-h-[90vh] max-h-[90dvh] p-0 flex flex-col overflow-hidden">
      <form onSubmit={form.handleSubmit} className="flex flex-1 min-h-0 flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" aria-hidden="true" />
            <DialogTitle>{t("createDialog.title")}</DialogTitle>
          </div>
          <DialogDescription className="sr-only">{t("createDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-6 pb-6 space-y-8">
          <UserEditSection
            user={{
              id: 0,
              name: currentUserDraft.name || "",
              description: currentUserDraft.note || "",
              tags: currentUserDraft.tags || [],
              expiresAt: currentUserDraft.expiresAt ?? null,
              providerGroup: PROVIDER_GROUP.DEFAULT,
              rpm: currentUserDraft.rpm ?? 0,
              limit5hUsd: currentUserDraft.limit5hUsd ?? null,
              dailyQuota: currentUserDraft.dailyQuota ?? null,
              limitWeeklyUsd: currentUserDraft.limitWeeklyUsd ?? null,
              limitMonthlyUsd: currentUserDraft.limitMonthlyUsd ?? null,
              limitTotalUsd: currentUserDraft.limitTotalUsd ?? null,
              limitConcurrentSessions: currentUserDraft.limitConcurrentSessions ?? null,
              dailyResetMode: currentUserDraft.dailyResetMode ?? "fixed",
              dailyResetTime: currentUserDraft.dailyResetTime ?? "00:00",
              allowedClients: currentUserDraft.allowedClients || [],
              allowedModels: currentUserDraft.allowedModels || [],
            }}
            isEnabled={true}
            showProviderGroup={false}
            onChange={handleUserChange}
            translations={userEditTranslations}
            modelSuggestions={modelSuggestions}
          />

          <Separator />

          <KeyEditSection
            keyData={{
              id: currentKeyDraft.id,
              name: currentKeyDraft.name || "",
              expiresAt: currentKeyDraft.expiresAt ? new Date(currentKeyDraft.expiresAt) : null,
              isEnabled: currentKeyDraft.isEnabled ?? true,
              canLoginWebUi: currentKeyDraft.canLoginWebUi ?? false,
              providerGroup: normalizeProviderGroup(currentKeyDraft.providerGroup),
              cacheTtlPreference: currentKeyDraft.cacheTtlPreference ?? "inherit",
              limit5hUsd: currentKeyDraft.limit5hUsd ?? null,
              limitDailyUsd: currentKeyDraft.limitDailyUsd ?? null,
              dailyResetMode: currentKeyDraft.dailyResetMode ?? "fixed",
              dailyResetTime: currentKeyDraft.dailyResetTime ?? "00:00",
              limitWeeklyUsd: currentKeyDraft.limitWeeklyUsd ?? null,
              limitMonthlyUsd: currentKeyDraft.limitMonthlyUsd ?? null,
              limitTotalUsd: currentKeyDraft.limitTotalUsd ?? null,
              limitConcurrentSessions: currentKeyDraft.limitConcurrentSessions ?? 0,
            }}
            isAdmin={true}
            showLimitRules={false}
            showExpireTime={false}
            onChange={handleKeyChange}
            translations={keyEditTranslations}
          />
        </div>

        {errorMessage && <div className="px-6 pb-2 text-sm text-destructive">{errorMessage}</div>}

        <DialogFooter className="px-6 pb-6 flex-shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isPending ? t("createDialog.creating") : t("createDialog.create")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

export function CreateUserDialog(props: CreateUserDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <CreateUserDialogInner {...props} /> : null}
    </Dialog>
  );
}

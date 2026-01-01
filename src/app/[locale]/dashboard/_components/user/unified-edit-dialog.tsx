"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  KeyRound,
  Loader2,
  Plus,
  Trash2,
  UserCog,
  UserPlus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { addKey, editKey, removeKey } from "@/actions/keys";
import { getFilterOptions } from "@/actions/usage-logs";
import { createUserOnly, editUser, removeUser, toggleUserEnabled } from "@/actions/users";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { useZodForm } from "@/lib/hooks/use-zod-form";
import { KeyFormSchema, UpdateUserSchema } from "@/lib/validation/schemas";
import type { UserDisplay } from "@/types/user";
import { DangerZone } from "./forms/danger-zone";
import { KeyEditSection } from "./forms/key-edit-section";
import { UserEditSection } from "./forms/user-edit-section";

export interface UnifiedEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  user?: UserDisplay; // Required in edit mode, optional in create mode
  keyOnlyMode?: boolean;
  scrollToKeyId?: number;
  onSuccess?: () => void;
  currentUser?: { id: number; role: string };
}

const UnifiedUserSchema = UpdateUserSchema.extend({
  name: z.string().min(1).max(64),
  providerGroup: z.string().max(50).nullable().optional(),
  allowedClients: z.array(z.string().max(64)).max(50).optional().default([]),
  allowedModels: z.array(z.string().max(64)).max(50).optional().default([]),
  dailyQuota: z.number().nullable().optional(),
});

const UnifiedKeySchema = KeyFormSchema.extend({
  id: z.number(), // Negative IDs indicate new keys to be created
  isEnabled: z.boolean().optional(),
});

const UnifiedEditSchema = z.object({
  user: UnifiedUserSchema,
  keys: z.array(UnifiedKeySchema),
});

type UnifiedEditValues = z.infer<typeof UnifiedEditSchema>;

// Generate unique temporary negative IDs for new keys using timestamp + random
function getNextTempKeyId() {
  return -Math.floor(Date.now() + Math.random() * 1000);
}

function parseYmdToEndOfDayIso(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map((v) => Number(v));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return undefined;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

function getKeyExpiresAtIso(expiresAt: string): string | undefined {
  if (!expiresAt) return undefined;
  const ymd = parseYmdToEndOfDayIso(expiresAt);
  if (ymd) return ymd;
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function normalizeProviderGroup(value: unknown): string {
  if (value === null || value === undefined) return PROVIDER_GROUP.DEFAULT;
  if (typeof value !== "string") return PROVIDER_GROUP.DEFAULT;
  const trimmed = value.trim();
  if (trimmed === "") return PROVIDER_GROUP.DEFAULT;

  const groups = trimmed
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  if (groups.length === 0) return PROVIDER_GROUP.DEFAULT;

  return Array.from(new Set(groups)).sort().join(",");
}

function buildDefaultValues(
  mode: "create" | "edit",
  user?: UserDisplay,
  keyOnlyMode?: boolean
): UnifiedEditValues {
  if (mode === "create") {
    return {
      user: {
        name: keyOnlyMode ? (user?.name ?? "self") : "",
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
      keys: [
        {
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
      ],
    };
  }

  // Edit mode - user must exist
  if (!user) {
    throw new Error("User is required in edit mode");
  }

  return {
    user: {
      name: user.name || "",
      note: user.note || "",
      tags: user.tags || [],
      expiresAt: user.expiresAt ?? undefined,
      providerGroup: normalizeProviderGroup(user.providerGroup),
      rpm: user.rpm ?? 0,
      limit5hUsd: user.limit5hUsd ?? null,
      dailyQuota: user.dailyQuota ?? null,
      limitWeeklyUsd: user.limitWeeklyUsd ?? null,
      limitMonthlyUsd: user.limitMonthlyUsd ?? null,
      limitTotalUsd: user.limitTotalUsd ?? null,
      limitConcurrentSessions: user.limitConcurrentSessions ?? null,
      dailyResetMode: user.dailyResetMode ?? "fixed",
      dailyResetTime: user.dailyResetTime ?? "00:00",
      allowedClients: user.allowedClients || [],
      allowedModels: user.allowedModels || [],
    },
    keys: user.keys.map((key) => ({
      id: key.id,
      name: key.name || "",
      isEnabled: key.status === "enabled",
      expiresAt: getKeyExpiresAtIso(key.expiresAt),
      canLoginWebUi: key.canLoginWebUi ?? false,
      providerGroup: normalizeProviderGroup(key.providerGroup),
      cacheTtlPreference: "inherit" as const,
      limit5hUsd: key.limit5hUsd ?? null,
      limitDailyUsd: key.limitDailyUsd ?? null,
      dailyResetMode: key.dailyResetMode ?? "fixed",
      dailyResetTime: key.dailyResetTime ?? "00:00",
      limitWeeklyUsd: key.limitWeeklyUsd ?? null,
      limitMonthlyUsd: key.limitMonthlyUsd ?? null,
      limitTotalUsd: key.limitTotalUsd ?? null,
      limitConcurrentSessions: key.limitConcurrentSessions ?? 0,
    })),
  };
}

function getFirstErrorMessage(errors: Record<string, string>) {
  if (errors._form) return errors._form;
  const first = Object.entries(errors).find(([, msg]) => Boolean(msg));
  return first?.[1] || null;
}

function UnifiedEditDialogInner({
  onOpenChange,
  mode,
  user,
  keyOnlyMode,
  scrollToKeyId,
  onSuccess,
  currentUser,
}: UnifiedEditDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("dashboard.userManagement");
  const tUsers = useTranslations("dashboard.users");
  const tCommon = useTranslations("common");
  const [isPending, startTransition] = useTransition();
  const keyScrollRef = useRef<HTMLDivElement>(null);
  const isAdmin = currentUser?.role === "admin";
  const isKeyOnlyMode = Boolean(keyOnlyMode);
  const [deletedKeyIds, setDeletedKeyIds] = useState<number[]>([]);
  const [keyToDelete, setKeyToDelete] = useState<{ id: number; name: string } | null>(null);
  const [newlyAddedKeyId, setNewlyAddedKeyId] = useState<number | null>(null);
  const [expandedKeyIds, setExpandedKeyIds] = useState<Set<number>>(() => {
    // Create mode or single key: all expanded
    if (mode === "create") return new Set([-1]); // placeholder for new keys
    if (!user || user.keys.length <= 1) return new Set(user?.keys.map((k) => k.id) || []);
    // Edit mode with multiple keys: only scrollToKeyId expanded
    if (scrollToKeyId) return new Set([scrollToKeyId]);
    return new Set(); // All collapsed
  });
  const [modelSuggestions, setModelSuggestions] = useState<string[]>([]);

  // Fetch model suggestions for access restrictions
  useEffect(() => {
    getFilterOptions()
      .then((res) => {
        if (res.ok && res.data) {
          setModelSuggestions(res.data.models);
        }
      })
      .catch(() => {
        // Silently fail - model suggestions are optional enhancement
        // User can still manually type model names
      });
  }, []);

  // Auto-scroll to newly added key
  useEffect(() => {
    if (newlyAddedKeyId && keyScrollRef.current) {
      // Small delay to ensure DOM is updated
      const timer = setTimeout(() => {
        keyScrollRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        setNewlyAddedKeyId(null);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [newlyAddedKeyId]);

  const defaultValues = useMemo(
    () => buildDefaultValues(mode, user, keyOnlyMode),
    [mode, user, keyOnlyMode]
  );

  const userProviderGroups = useMemo(() => {
    return normalizeProviderGroup(user?.providerGroup)
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean);
  }, [user?.providerGroup]);

  const toggleKeyExpanded = (keyId: number) => {
    setExpandedKeyIds((prev) => {
      const next = new Set(prev);
      if (next.has(keyId)) {
        next.delete(keyId);
      } else {
        next.add(keyId);
      }
      return next;
    });
  };

  const form = useZodForm({
    schema: UnifiedEditSchema,
    defaultValues,
    onSubmit: async (data) => {
      startTransition(async () => {
        try {
          // 验证: 编辑模式下,至少需要一个启用的 key(防止用户禁用所有 key)
          if (mode === "edit") {
            const enabledKeyCount = data.keys.filter((k) => k.isEnabled).length;
            if (enabledKeyCount === 0) {
              toast.error(t("editDialog.atLeastOneKeyEnabled"));
              return;
            }
          }

          if (mode === "create") {
            if (isKeyOnlyMode) {
              const targetUserId = user?.id ?? currentUser?.id;
              if (!targetUserId) {
                toast.error(t("editDialog.operationFailed"));
                return;
              }

              for (const key of data.keys) {
                const keyRes = await addKey({
                  userId: targetUserId,
                  name: key.name,
                  expiresAt: key.expiresAt || undefined,
                  canLoginWebUi: key.canLoginWebUi,
                  providerGroup: normalizeProviderGroup(key.providerGroup),
                  cacheTtlPreference: key.cacheTtlPreference,
                  limit5hUsd: key.limit5hUsd,
                  limitDailyUsd: key.limitDailyUsd,
                  dailyResetMode: key.dailyResetMode,
                  dailyResetTime: key.dailyResetTime,
                  limitWeeklyUsd: key.limitWeeklyUsd,
                  limitMonthlyUsd: key.limitMonthlyUsd,
                  limitTotalUsd: key.limitTotalUsd,
                  limitConcurrentSessions: key.limitConcurrentSessions,
                });
                if (!keyRes.ok) {
                  toast.error(
                    keyRes.error || t("createDialog.keyCreateFailed", { name: key.name })
                  );
                  return;
                }
              }

              toast.success(t("editDialog.saveSuccess"));
            } else {
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

              // Create all keys for the new user
              // If any key creation fails, rollback by deleting the user
              for (const key of data.keys) {
                const keyRes = await addKey({
                  userId: newUserId,
                  name: key.name,
                  expiresAt: key.expiresAt || undefined,
                  canLoginWebUi: key.canLoginWebUi,
                  providerGroup: normalizeProviderGroup(key.providerGroup),
                  cacheTtlPreference: key.cacheTtlPreference,
                  limit5hUsd: key.limit5hUsd,
                  limitDailyUsd: key.limitDailyUsd,
                  dailyResetMode: key.dailyResetMode,
                  dailyResetTime: key.dailyResetTime,
                  limitWeeklyUsd: key.limitWeeklyUsd,
                  limitMonthlyUsd: key.limitMonthlyUsd,
                  limitTotalUsd: key.limitTotalUsd,
                  limitConcurrentSessions: key.limitConcurrentSessions,
                });
                if (!keyRes.ok) {
                  // Rollback: delete the user since key creation failed
                  try {
                    await removeUser(newUserId);
                  } catch (rollbackError) {
                    console.error("[UnifiedEditDialog] rollback failed", rollbackError);
                  }
                  toast.error(
                    keyRes.error || t("createDialog.keyCreateFailed", { name: key.name })
                  );
                  return;
                }
              }

              toast.success(t("createDialog.createSuccess"));
            }
          } else {
            // Edit mode - user must exist
            if (!user) return;

            if (!isKeyOnlyMode) {
              const userRes = await editUser(user.id, {
                name: data.user.name,
                note: data.user.note,
                tags: data.user.tags,
                expiresAt: data.user.expiresAt ?? null,
                providerGroup: normalizeProviderGroup(data.user.providerGroup),
                rpm: data.user.rpm,
                limit5hUsd: data.user.limit5hUsd,
                dailyQuota: data.user.dailyQuota,
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
                toast.error(userRes.error || t("editDialog.saveFailed"));
                return;
              }
            }

            // Handle keys: edit existing, create new (negative ID), delete removed
            for (const key of data.keys) {
              if (key.id < 0) {
                // New key - create it
                const keyRes = await addKey({
                  userId: user.id,
                  name: key.name,
                  expiresAt: key.expiresAt || undefined,
                  isEnabled: key.isEnabled,
                  canLoginWebUi: key.canLoginWebUi,
                  providerGroup: normalizeProviderGroup(key.providerGroup),
                  cacheTtlPreference: key.cacheTtlPreference,
                  limit5hUsd: key.limit5hUsd,
                  limitDailyUsd: key.limitDailyUsd,
                  dailyResetMode: key.dailyResetMode,
                  dailyResetTime: key.dailyResetTime,
                  limitWeeklyUsd: key.limitWeeklyUsd,
                  limitMonthlyUsd: key.limitMonthlyUsd,
                  limitTotalUsd: key.limitTotalUsd,
                  limitConcurrentSessions: key.limitConcurrentSessions,
                });
                if (!keyRes.ok) {
                  toast.error(
                    keyRes.error || t("createDialog.keyCreateFailed", { name: key.name })
                  );
                  return;
                }
              } else {
                // Existing key - edit it
                const keyRes = await editKey(key.id, {
                  name: key.name,
                  expiresAt: key.expiresAt || undefined,
                  canLoginWebUi: key.canLoginWebUi,
                  isEnabled: key.isEnabled,
                  providerGroup: normalizeProviderGroup(key.providerGroup),
                  cacheTtlPreference: key.cacheTtlPreference,
                  limit5hUsd: key.limit5hUsd,
                  limitDailyUsd: key.limitDailyUsd,
                  dailyResetMode: key.dailyResetMode,
                  dailyResetTime: key.dailyResetTime,
                  limitWeeklyUsd: key.limitWeeklyUsd,
                  limitMonthlyUsd: key.limitMonthlyUsd,
                  limitTotalUsd: key.limitTotalUsd,
                  limitConcurrentSessions: key.limitConcurrentSessions,
                });
                if (!keyRes.ok) {
                  toast.error(keyRes.error || t("editDialog.keySaveFailed", { name: key.name }));
                  return;
                }
              }
            }

            // Delete removed keys
            for (const deletedKeyId of deletedKeyIds) {
              const deleteRes = await removeKey(deletedKeyId);
              if (!deleteRes.ok) {
                toast.error(deleteRes.error || t("editDialog.keyDeleteFailed"));
                return;
              }
            }

            toast.success(t("editDialog.saveSuccess"));
          }

          onSuccess?.();
          onOpenChange(false);
          queryClient.invalidateQueries({ queryKey: ["users"] });
          router.refresh();
        } catch (error) {
          console.error("[UnifiedEditDialog] submit failed", error);
          toast.error(
            mode === "create"
              ? isKeyOnlyMode
                ? t("editDialog.operationFailed")
                : t("createDialog.saveFailed")
              : t("editDialog.saveFailed")
          );
        }
      });
    },
  });

  const errorMessage = useMemo(() => getFirstErrorMessage(form.errors), [form.errors]);

  const keys = (form.values.keys || defaultValues.keys) as UnifiedEditValues["keys"];
  const currentUserDraft = form.values.user || defaultValues.user;
  const showUserProviderGroup = mode === "edit" && Boolean(user?.providerGroup?.trim());

  const userEditTranslations = useMemo(() => {
    return {
      sections: {
        basicInfo: t("userEditSection.sections.basicInfo"),
        expireTime: t("userEditSection.sections.expireTime"),
        limitRules: t("userEditSection.sections.limitRules"),
        accessRestrictions: t("userEditSection.sections.accessRestrictions"),
      },
      fields: {
        username: {
          label: t("userEditSection.fields.username.label"),
          placeholder: t("userEditSection.fields.username.placeholder"),
        },
        description: {
          label: t("userEditSection.fields.description.label"),
          placeholder: t("userEditSection.fields.description.placeholder"),
        },
        tags: {
          label: t("userEditSection.fields.tags.label"),
          placeholder: t("userEditSection.fields.tags.placeholder"),
        },
        providerGroup: showUserProviderGroup
          ? {
              label: t("userEditSection.fields.providerGroup.label"),
              placeholder: t("userEditSection.fields.providerGroup.placeholder"),
            }
          : undefined,
        enableStatus:
          mode === "edit" && isAdmin
            ? {
                label: t("userEditSection.fields.enableStatus.label"),
                enabledDescription: t("userEditSection.fields.enableStatus.enabledDescription"),
                disabledDescription: t("userEditSection.fields.enableStatus.disabledDescription"),
                confirmEnable: t("userEditSection.fields.enableStatus.confirmEnable"),
                confirmDisable: t("userEditSection.fields.enableStatus.confirmDisable"),
                confirmEnableTitle: t("userEditSection.fields.enableStatus.confirmEnableTitle"),
                confirmDisableTitle: t("userEditSection.fields.enableStatus.confirmDisableTitle"),
                confirmEnableDescription: t(
                  "userEditSection.fields.enableStatus.confirmEnableDescription"
                ),
                confirmDisableDescription: t(
                  "userEditSection.fields.enableStatus.confirmDisableDescription"
                ),
                cancel: t("userEditSection.fields.enableStatus.cancel"),
                processing: t("userEditSection.fields.enableStatus.processing"),
              }
            : undefined,
        allowedClients: {
          label: t("userEditSection.fields.allowedClients.label"),
          description: t("userEditSection.fields.allowedClients.description"),
          customLabel: t("userEditSection.fields.allowedClients.customLabel"),
          customPlaceholder: t("userEditSection.fields.allowedClients.customPlaceholder"),
        },
        allowedModels: {
          label: t("userEditSection.fields.allowedModels.label"),
          placeholder: t("userEditSection.fields.allowedModels.placeholder"),
          description: t("userEditSection.fields.allowedModels.description"),
        },
      },
      presetClients: {
        "claude-cli": t("userEditSection.presetClients.claude-cli"),
        "gemini-cli": t("userEditSection.presetClients.gemini-cli"),
        "factory-cli": t("userEditSection.presetClients.factory-cli"),
        "codex-cli": t("userEditSection.presetClients.codex-cli"),
      },
      limitRules: {
        addRule: t("limitRules.addRule"),
        ruleTypes: {
          limitRpm: t("limitRules.ruleTypes.limitRpm"),
          limit5h: t("limitRules.ruleTypes.limit5h"),
          limitDaily: t("limitRules.ruleTypes.limitDaily"),
          limitWeekly: t("limitRules.ruleTypes.limitWeekly"),
          limitMonthly: t("limitRules.ruleTypes.limitMonthly"),
          limitTotal: t("limitRules.ruleTypes.limitTotal"),
          limitSessions: t("limitRules.ruleTypes.limitSessions"),
        },
        quickValues: {
          unlimited: t("limitRules.quickValues.unlimited"),
          "10": t("limitRules.quickValues.10"),
          "50": t("limitRules.quickValues.50"),
          "100": t("limitRules.quickValues.100"),
          "500": t("limitRules.quickValues.500"),
        },
      },
      quickExpire: {
        week: t("quickExpire.oneWeek"),
        month: t("quickExpire.oneMonth"),
        threeMonths: t("quickExpire.threeMonths"),
        year: t("quickExpire.oneYear"),
      },
    };
  }, [t, showUserProviderGroup, mode, isAdmin]);

  const keyEditTranslations = useMemo(() => {
    return {
      sections: {
        basicInfo: t("keyEditSection.sections.basicInfo"),
        expireTime: t("keyEditSection.sections.expireTime"),
        limitRules: t("keyEditSection.sections.limitRules"),
        specialFeatures: t("keyEditSection.sections.specialFeatures"),
      },
      fields: {
        keyName: {
          label: t("keyEditSection.fields.keyName.label"),
          placeholder: t("keyEditSection.fields.keyName.placeholder"),
        },
        enableStatus: {
          label: t("keyEditSection.fields.enableStatus.label"),
          description: t("keyEditSection.fields.enableStatus.description"),
          cannotDisableTooltip: t("keyEditSection.fields.enableStatus.cannotDisableTooltip"),
        },
        balanceQueryPage: {
          label: t("keyEditSection.fields.balanceQueryPage.label"),
          description: t("keyEditSection.fields.balanceQueryPage.description"),
          descriptionEnabled: t("keyEditSection.fields.balanceQueryPage.descriptionEnabled"),
          descriptionDisabled: t("keyEditSection.fields.balanceQueryPage.descriptionDisabled"),
        },
        providerGroup: {
          label: t("keyEditSection.fields.providerGroup.label"),
          placeholder: t("keyEditSection.fields.providerGroup.placeholder"),
          selectHint: t("keyEditSection.fields.providerGroup.selectHint"),
          allGroups: t("keyEditSection.fields.providerGroup.allGroups"),
          noGroupHint: t("keyEditSection.fields.providerGroup.noGroupHint"),
        },
        cacheTtl: {
          label: t("keyEditSection.fields.cacheTtl.label"),
          options: {
            inherit: t("keyEditSection.fields.cacheTtl.options.inherit"),
            "5m": t("keyEditSection.fields.cacheTtl.options.5m"),
            "1h": t("keyEditSection.fields.cacheTtl.options.1h"),
          },
        },
      },
      limitRules: {
        title: t("keyEditSection.limitRules.title"),
        limitTypes: {
          limitRpm: t("limitRules.ruleTypes.limitRpm"),
          limit5h: t("limitRules.ruleTypes.limit5h"),
          limitDaily: t("limitRules.ruleTypes.limitDaily"),
          limitWeekly: t("limitRules.ruleTypes.limitWeekly"),
          limitMonthly: t("limitRules.ruleTypes.limitMonthly"),
          limitTotal: t("limitRules.ruleTypes.limitTotal"),
          limitSessions: t("limitRules.ruleTypes.limitSessions"),
        },
        quickValues: {
          unlimited: t("limitRules.quickValues.unlimited"),
          "10": t("limitRules.quickValues.10"),
          "50": t("limitRules.quickValues.50"),
          "100": t("limitRules.quickValues.100"),
          "500": t("limitRules.quickValues.500"),
        },
        actions: {
          add: t("keyEditSection.limitRules.actions.add"),
          remove: t("keyEditSection.limitRules.actions.remove"),
        },
        daily: {
          mode: {
            fixed: t("keyEditSection.limitRules.daily.mode.fixed"),
            rolling: t("keyEditSection.limitRules.daily.mode.rolling"),
          },
        },
      },
      quickExpire: {
        week: t("quickExpire.oneWeek"),
        month: t("quickExpire.oneMonth"),
        threeMonths: t("quickExpire.threeMonths"),
        year: t("quickExpire.oneYear"),
      },
    };
  }, [t]);

  const handleUserChange = (field: string | Record<string, any>, value?: any) => {
    const prev = form.values.user || (defaultValues.user as UnifiedEditValues["user"]);
    const next = { ...prev } as UnifiedEditValues["user"];

    if (typeof field === "object") {
      // Batch update: apply multiple fields at once
      Object.entries(field).forEach(([key, val]) => {
        const mappedField = key === "description" ? "note" : key;
        (next as any)[mappedField] = mappedField === "expiresAt" ? (val ?? undefined) : val;
      });
    } else {
      // Single field update (backward compatible)
      const mappedField = field === "description" ? "note" : field;
      if (mappedField === "expiresAt") {
        (next as any)[mappedField] = value ?? undefined;
      } else {
        (next as any)[mappedField] = value;
      }
    }
    form.setValue("user", next);
  };

  const handleKeyChange = (keyId: number, field: string | Record<string, any>, value?: any) => {
    const prevKeys = (form.values.keys || defaultValues.keys) as UnifiedEditValues["keys"];
    const nextKeys = prevKeys.map((k) => {
      if (k.id !== keyId) return k;

      if (typeof field === "object") {
        // Batch update
        const updates: Record<string, any> = {};
        Object.entries(field).forEach(([key, val]) => {
          if (key === "expiresAt") {
            updates[key] = val ? (val as Date).toISOString() : undefined;
          } else {
            updates[key] = val;
          }
        });
        return { ...k, ...updates };
      }

      // Single field update (backward compatible)
      if (field === "expiresAt") {
        return { ...k, expiresAt: value ? (value as Date).toISOString() : undefined };
      }
      return { ...k, [field]: value };
    });
    form.setValue("keys", nextKeys);
  };

  const handleAddKey = () => {
    const prevKeys = (form.values.keys || defaultValues.keys) as UnifiedEditValues["keys"];
    const newKeyId = getNextTempKeyId();
    const newKey = {
      id: newKeyId,
      name: "",
      isEnabled: true,
      expiresAt: undefined,
      canLoginWebUi: true,
      providerGroup: PROVIDER_GROUP.DEFAULT,
      cacheTtlPreference: "inherit" as const,
      limit5hUsd: null,
      limitDailyUsd: null,
      dailyResetMode: "fixed" as const,
      dailyResetTime: "00:00",
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
      limitConcurrentSessions: 0,
    };
    form.setValue("keys", [...prevKeys, newKey]);
    // Trigger auto-scroll to the newly added key
    setNewlyAddedKeyId(newKeyId);
    // Auto-expand the newly added key
    setExpandedKeyIds((prev) => new Set([...prev, newKeyId]));
  };

  const handleRemoveKey = (keyId: number, keyName: string) => {
    if (keyId < 0) {
      // New key (not yet saved) - remove directly without confirmation
      const prevKeys = (form.values.keys || defaultValues.keys) as UnifiedEditValues["keys"];
      form.setValue(
        "keys",
        prevKeys.filter((k) => k.id !== keyId)
      );
    } else {
      // Existing key - show confirmation dialog
      setKeyToDelete({ id: keyId, name: keyName });
    }
  };

  const confirmRemoveKey = () => {
    if (!keyToDelete) return;
    const prevKeys = (form.values.keys || defaultValues.keys) as UnifiedEditValues["keys"];
    form.setValue(
      "keys",
      prevKeys.filter((k) => k.id !== keyToDelete.id)
    );
    setDeletedKeyIds((prev) => [...prev, keyToDelete.id]);
    setKeyToDelete(null);
  };

  const handleDisableUser = async () => {
    if (!user) return;
    const res = await toggleUserEnabled(user.id, false);
    if (!res.ok) {
      throw new Error(res.error || t("editDialog.operationFailed"));
    }
    toast.success(t("editDialog.userDisabled"));
    onSuccess?.();
    queryClient.invalidateQueries({ queryKey: ["users"] });
    router.refresh();
  };

  const handleEnableUser = async () => {
    if (!user) return;
    const res = await toggleUserEnabled(user.id, true);
    if (!res.ok) {
      throw new Error(res.error || t("editDialog.operationFailed"));
    }
    toast.success(t("editDialog.userEnabled"));
    onSuccess?.();
    queryClient.invalidateQueries({ queryKey: ["users"] });
    router.refresh();
  };

  const handleDeleteUser = async () => {
    if (!user) return;
    const res = await removeUser(user.id);
    if (!res.ok) {
      throw new Error(res.error || t("editDialog.deleteFailed"));
    }
    toast.success(t("editDialog.userDeleted"));
    onSuccess?.();
    onOpenChange(false);
    queryClient.invalidateQueries({ queryKey: ["users"] });
    router.refresh();
  };

  return (
    <DialogContent className="w-full max-w-[95vw] sm:max-w-[85vw] md:max-w-[70vw] lg:max-w-4xl max-h-[90vh] max-h-[90dvh] p-0 flex flex-col overflow-hidden">
      <form onSubmit={form.handleSubmit} className="flex flex-1 min-h-0 flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
          <div className="flex items-center gap-2">
            {isKeyOnlyMode ? (
              <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" />
            ) : mode === "create" ? (
              <UserPlus className="h-5 w-5 text-primary" aria-hidden="true" />
            ) : (
              <UserCog className="h-5 w-5 text-primary" aria-hidden="true" />
            )}
            <DialogTitle>
              {isKeyOnlyMode
                ? mode === "create"
                  ? t("dialog.createKeyTitle")
                  : t("dialog.editKeyTitle")
                : mode === "create"
                  ? t("createDialog.title")
                  : t("editDialog.title")}
            </DialogTitle>
          </div>
          <DialogDescription className="sr-only">
            {mode === "create" ? t("createDialog.description") : t("editDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-6 pb-6 space-y-8">
          {isKeyOnlyMode && userProviderGroups.length > 0 && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
              <div className="text-sm font-medium">{tUsers("dialog.userProviderGroup")}</div>
              <div className="flex flex-wrap gap-2">
                {userProviderGroups.map((group) => (
                  <Badge key={group} variant="secondary" className="text-xs">
                    {group}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {tUsers("dialog.userProviderGroupHint")}
              </p>
            </div>
          )}

          {isKeyOnlyMode ? null : (
            <>
              <UserEditSection
                user={{
                  id: user?.id ?? 0,
                  name: currentUserDraft.name || "",
                  description: currentUserDraft.note || "",
                  tags: currentUserDraft.tags || [],
                  expiresAt: currentUserDraft.expiresAt ?? null,
                  providerGroup: normalizeProviderGroup(currentUserDraft.providerGroup),
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
                isEnabled={mode === "edit" ? user?.isEnabled : undefined}
                onToggleEnabled={
                  mode === "edit" && isAdmin && user
                    ? async () => {
                        if (user.isEnabled) {
                          await handleDisableUser();
                        } else {
                          await handleEnableUser();
                        }
                      }
                    : undefined
                }
                showProviderGroup={showUserProviderGroup}
                onChange={handleUserChange}
                translations={userEditTranslations}
                modelSuggestions={modelSuggestions}
              />

              <Separator />
            </>
          )}

          <div className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm font-semibold">{t("createDialog.keysSection")}</span>
                <span className="text-xs text-muted-foreground">({keys.length})</span>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={handleAddKey}>
                <Plus className="mr-1 h-4 w-4" />
                {t("createDialog.addKey")}
              </Button>
            </div>
            <div className="space-y-8">
              {keys.map((key, index) => {
                const isExpanded =
                  mode === "create" || keys.length === 1 || expandedKeyIds.has(key.id);
                const showCollapseButton = mode === "edit" && keys.length > 1;
                // 计算当前是否是最后一个启用的 key
                const enabledKeysCount = keys.filter((k) => k.isEnabled).length;
                const isLastEnabledKey = key.isEnabled && enabledKeysCount === 1;

                return (
                  <div
                    key={key.id}
                    className="relative rounded-xl border border-border bg-card p-4 pt-6 shadow-sm"
                  >
                    <div className="absolute -top-3 left-4 z-10 px-2 py-0.5 bg-background border border-border rounded-md text-xs font-medium text-muted-foreground">
                      Key #{index + 1}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="absolute right-3 top-3 h-9 w-9 border-border text-muted-foreground hover:text-destructive hover:border-destructive hover:bg-destructive/10"
                      onClick={() => handleRemoveKey(key.id, key.name)}
                      disabled={keys.length === 1}
                      title={
                        keys.length === 1
                          ? t("createDialog.cannotDeleteLastKey")
                          : t("createDialog.removeKey")
                      }
                      aria-label={
                        keys.length === 1
                          ? t("createDialog.cannotDeleteLastKey")
                          : t("createDialog.removeKey")
                      }
                    >
                      <Trash2 className="h-5 w-5" aria-hidden="true" />
                    </Button>

                    {/* Collapsed view */}
                    {!isExpanded && (
                      <div
                        className="flex items-center justify-between gap-4 cursor-pointer pr-12"
                        onClick={() => toggleKeyExpanded(key.id)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="font-medium truncate">{key.name || "Unnamed Key"}</span>
                          <Badge variant={key.isEnabled ? "default" : "secondary"}>
                            {key.isEnabled ? t("keyStatus.enabled") : t("keyStatus.disabled")}
                          </Badge>
                          <span className="text-sm text-muted-foreground truncate">
                            {normalizeProviderGroup(key.providerGroup)}
                          </span>
                        </div>
                        {showCollapseButton && (
                          <Button type="button" variant="ghost" size="sm">
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Expanded view */}
                    {isExpanded && (
                      <>
                        {showCollapseButton && (
                          <div className="flex justify-end mb-2 pr-12">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleKeyExpanded(key.id)}
                            >
                              <ChevronUp className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                        <KeyEditSection
                          keyData={{
                            id: key.id,
                            name: key.name,
                            isEnabled: key.isEnabled ?? true,
                            expiresAt: key.expiresAt ? new Date(key.expiresAt) : null,
                            canLoginWebUi: key.canLoginWebUi ?? false,
                            providerGroup: normalizeProviderGroup(key.providerGroup),
                            cacheTtlPreference: key.cacheTtlPreference ?? "inherit",
                            limit5hUsd: key.limit5hUsd ?? null,
                            limitDailyUsd: key.limitDailyUsd ?? null,
                            dailyResetMode: key.dailyResetMode ?? "fixed",
                            dailyResetTime: key.dailyResetTime ?? "00:00",
                            limitWeeklyUsd: key.limitWeeklyUsd ?? null,
                            limitMonthlyUsd: key.limitMonthlyUsd ?? null,
                            limitTotalUsd: key.limitTotalUsd ?? null,
                            limitConcurrentSessions: key.limitConcurrentSessions ?? 0,
                          }}
                          isAdmin={isAdmin}
                          isLastEnabledKey={isLastEnabledKey}
                          userProviderGroup={user?.providerGroup ?? undefined}
                          onChange={
                            ((fieldOrBatch: string | Record<string, any>, value?: any) =>
                              handleKeyChange(key.id, fieldOrBatch, value)) as {
                              (field: string, value: any): void;
                              (batch: Record<string, any>): void;
                            }
                          }
                          scrollRef={
                            scrollToKeyId === key.id || newlyAddedKeyId === key.id
                              ? keyScrollRef
                              : undefined
                          }
                          translations={keyEditTranslations}
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {mode === "edit" && isAdmin && user && (
            <DangerZone
              userId={user.id}
              userName={user.name}
              onDelete={handleDeleteUser}
              translations={t.raw("dangerZone") as Record<string, unknown>}
            />
          )}
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
            {isPending
              ? mode === "create"
                ? t("createDialog.creating")
                : t("editDialog.saving")
              : mode === "create"
                ? t("createDialog.create")
                : tCommon("save")}
          </Button>
        </DialogFooter>
      </form>

      {/* Delete key confirmation dialog */}
      <AlertDialog open={!!keyToDelete} onOpenChange={(open) => !open && setKeyToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("createDialog.confirmRemoveKeyTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("createDialog.confirmRemoveKeyDescription", { name: keyToDelete?.name || "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemoveKey}>{tCommon("confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DialogContent>
  );
}

export function UnifiedEditDialog(props: UnifiedEditDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? (
        <UnifiedEditDialogInner
          key={props.mode === "edit" ? props.user?.id : "create"}
          {...props}
        />
      ) : null}
    </Dialog>
  );
}

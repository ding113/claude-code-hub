"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useTransition } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { editKey } from "@/actions/keys";
import { editUser, removeUser, toggleUserEnabled } from "@/actions/users";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useZodForm } from "@/lib/hooks/use-zod-form";
import { KeyFormSchema, UpdateUserSchema } from "@/lib/validation/schemas";
import type { UserDisplay } from "@/types/user";
import { DangerZone } from "./forms/danger-zone";
import { KeyEditSection } from "./forms/key-edit-section";
import { UserEditSection } from "./forms/user-edit-section";

export interface UnifiedEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserDisplay; // 包含 keys 数组
  scrollToKeyId?: number; // 打开时自动滚动到该 Key
  onSuccess?: () => void;
  currentUser?: { role: string };
}

const UnifiedUserSchema = UpdateUserSchema.extend({
  name: z.string().min(1, "用户名不能为空").max(64, "用户名不能超过64个字符"),
});

const UnifiedKeySchema = KeyFormSchema.extend({
  id: z.number(),
});

const UnifiedEditSchema = z.object({
  user: UnifiedUserSchema,
  keys: z.array(UnifiedKeySchema),
});

type UnifiedEditValues = z.infer<typeof UnifiedEditSchema>;

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

function buildDefaultValues(user: UserDisplay): UnifiedEditValues {
  return {
    user: {
      name: user.name || "",
      note: user.note || "",
      tags: user.tags || [],
      expiresAt: user.expiresAt ?? undefined,
      limit5hUsd: user.limit5hUsd ?? null,
      limitWeeklyUsd: user.limitWeeklyUsd ?? null,
      limitMonthlyUsd: user.limitMonthlyUsd ?? null,
      limitTotalUsd: user.limitTotalUsd ?? null,
      limitConcurrentSessions: user.limitConcurrentSessions ?? null,
      dailyResetMode: user.dailyResetMode ?? "fixed",
      dailyResetTime: user.dailyResetTime ?? "00:00",
    },
    keys: user.keys.map((key) => ({
      id: key.id,
      name: key.name || "",
      expiresAt: getKeyExpiresAtIso(key.expiresAt),
      canLoginWebUi: key.canLoginWebUi ?? true,
      providerGroup: key.providerGroup || "",
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
  user,
  scrollToKeyId,
  onSuccess,
  currentUser,
}: UnifiedEditDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const keyScrollRef = useRef<HTMLDivElement>(null!);
  const isAdmin = currentUser?.role === "admin";

  const defaultValues = useMemo(() => buildDefaultValues(user), [user]);

  const form = useZodForm({
    schema: UnifiedEditSchema,
    defaultValues,
    onSubmit: async (data) => {
      startTransition(async () => {
        try {
          const userRes = await editUser(user.id, {
            name: data.user.name,
            note: data.user.note,
            tags: data.user.tags,
            expiresAt: data.user.expiresAt ?? null,
            limit5hUsd: data.user.limit5hUsd,
            limitWeeklyUsd: data.user.limitWeeklyUsd,
            limitMonthlyUsd: data.user.limitMonthlyUsd,
            limitTotalUsd: data.user.limitTotalUsd,
            limitConcurrentSessions: data.user.limitConcurrentSessions,
            dailyResetMode: data.user.dailyResetMode,
            dailyResetTime: data.user.dailyResetTime,
          });
          if (!userRes.ok) {
            toast.error(userRes.error || "保存失败");
            return;
          }

          for (const key of data.keys) {
            const keyRes = await editKey(key.id, {
              name: key.name,
              expiresAt: key.expiresAt || undefined,
              canLoginWebUi: key.canLoginWebUi,
              providerGroup: key.providerGroup?.trim() ? key.providerGroup.trim() : null,
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
              toast.error(keyRes.error || `密钥 "${key.name}" 保存失败`);
              return;
            }
          }

          toast.success("保存成功");
          onSuccess?.();
          onOpenChange(false);
          router.refresh();
        } catch (error) {
          console.error("[UnifiedEditDialog] submit failed", error);
          toast.error("保存失败，请稍后重试");
        }
      });
    },
  });

  const errorMessage = useMemo(() => getFirstErrorMessage(form.errors), [form.errors]);

  const userEditTranslations = useMemo(() => {
    return {
      sections: {
        basicInfo: "基本信息",
        expireTime: "过期时间",
        limitRules: "限额规则",
      },
      fields: {
        username: { label: "用户名", placeholder: "请输入用户名" },
        description: { label: "备注", placeholder: "请输入备注（可选）" },
        tags: { label: "用户标签", placeholder: "输入标签（回车添加）" },
      },
      limitRules: {
        addRule: "添加规则",
        ruleTypes: {
          limit5h: "5小时限额",
          limitDaily: "每日限额",
          limitWeekly: "周限额",
          limitMonthly: "月限额",
          limitTotal: "总限额",
          limitSessions: "并发 Session",
        },
        quickValues: {
          "10": "$10",
          "50": "$50",
          "100": "$100",
          "500": "$500",
        },
      },
      quickExpire: {
        week: "一周后",
        month: "一月后",
        threeMonths: "三月后",
        year: "一年后",
      },
    };
  }, []);

  const keyEditTranslations = useMemo(() => {
    return {
      sections: {
        basicInfo: "基本信息",
        expireTime: "过期时间",
        limitRules: "限额规则",
        specialFeatures: "特殊功能",
      },
      fields: {
        keyName: { label: "密钥名称", placeholder: "请输入密钥名称" },
        balanceQueryPage: {
          label: "允许登录 Web UI",
          description: "关闭后，此 Key 仅可用于 API 调用，无法登录管理后台",
        },
        providerGroup: { label: "供应商分组", placeholder: "留空=继承用户分组" },
        cacheTtl: {
          label: "Cache TTL 覆写",
          options: {
            inherit: "不覆写（跟随供应商/客户端）",
            "5m": "5m",
            "1h": "1h",
          },
        },
      },
      limitRules: {
        title: "添加限额规则",
        limitTypes: {
          limit5h: "5小时限额",
          limitDaily: "每日限额",
          limitWeekly: "周限额",
          limitMonthly: "月限额",
          limitTotal: "总限额",
          limitSessions: "并发 Session",
        },
        actions: {
          add: "添加规则",
          remove: "移除",
        },
        daily: {
          mode: {
            fixed: "固定时间重置",
            rolling: "滚动窗口（24小时）",
          },
        },
      },
      quickExpire: {
        week: "一周后",
        month: "一月后",
        threeMonths: "三月后",
        year: "一年后",
      },
    };
  }, []);

  const handleUserChange = (field: string, value: any) => {
    const prev = form.values.user || (defaultValues.user as UnifiedEditValues["user"]);
    const next = { ...prev } as UnifiedEditValues["user"];
    const mappedField = field === "description" ? "note" : field;
    if (mappedField === "expiresAt") {
      (next as any)[mappedField] = value ?? undefined;
    } else {
      (next as any)[mappedField] = value;
    }
    form.setValue("user", next);
  };

  const handleKeyChange = (keyId: number, field: string, value: any) => {
    const prevKeys = (form.values.keys || defaultValues.keys) as UnifiedEditValues["keys"];
    const nextKeys = prevKeys.map((k) => {
      if (k.id !== keyId) return k;
      if (field === "expiresAt") {
        return { ...k, expiresAt: value ? (value as Date).toISOString() : undefined };
      }
      return { ...k, [field]: value };
    });
    form.setValue("keys", nextKeys);
  };

  const keys = (form.values.keys || defaultValues.keys) as UnifiedEditValues["keys"];
  const currentUserDraft = form.values.user || defaultValues.user;

  const handleDisableUser = async () => {
    const res = await toggleUserEnabled(user.id, false);
    if (!res.ok) {
      throw new Error(res.error || "操作失败，请稍后重试");
    }
    toast.success("用户已禁用");
    onSuccess?.();
    router.refresh();
  };

  const handleDeleteUser = async () => {
    const res = await removeUser(user.id);
    if (!res.ok) {
      throw new Error(res.error || "删除失败，请稍后重试");
    }
    toast.success("用户已删除");
    onSuccess?.();
    onOpenChange(false);
    router.refresh();
  };

  return (
    <DialogContent className="max-w-[70vw] max-h-[80vh] p-0 overflow-hidden">
      <form onSubmit={form.handleSubmit} className="flex h-full flex-col">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>编辑用户与密钥</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-8">
          <UserEditSection
            user={{
              id: user.id,
              name: currentUserDraft.name || "",
              description: currentUserDraft.note || "",
              tags: currentUserDraft.tags || [],
              expiresAt: currentUserDraft.expiresAt ?? null,
              limit5hUsd: currentUserDraft.limit5hUsd ?? null,
              limitWeeklyUsd: currentUserDraft.limitWeeklyUsd ?? null,
              limitMonthlyUsd: currentUserDraft.limitMonthlyUsd ?? null,
              limitTotalUsd: currentUserDraft.limitTotalUsd ?? null,
              limitConcurrentSessions: currentUserDraft.limitConcurrentSessions ?? null,
              dailyResetMode: currentUserDraft.dailyResetMode ?? "fixed",
              dailyResetTime: currentUserDraft.dailyResetTime ?? "00:00",
            }}
            onChange={handleUserChange}
            translations={userEditTranslations}
          />

          <Separator />

          <div className="space-y-4">
            <div className="text-sm font-semibold">密钥编辑</div>
            <div className="space-y-8">
              {keys.map((key) => (
                <div key={key.id} className="rounded-lg border border-border bg-card p-4">
                  <KeyEditSection
                    keyData={{
                      id: key.id,
                      name: key.name,
                      expiresAt: key.expiresAt ? new Date(key.expiresAt) : null,
                      canLoginWebUi: key.canLoginWebUi ?? true,
                      providerGroup: key.providerGroup || null,
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
                    onChange={(field, value) => handleKeyChange(key.id, field, value)}
                    scrollRef={scrollToKeyId === key.id ? keyScrollRef : undefined}
                    translations={keyEditTranslations}
                  />
                </div>
              ))}
            </div>
          </div>

          {isAdmin && (
            <DangerZone
              userId={user.id}
              userName={user.name}
              isEnabled={user.isEnabled}
              onDisable={handleDisableUser}
              onDelete={handleDeleteUser}
              translations={{}}
            />
          )}
        </div>

        {errorMessage && <div className="px-6 pb-2 text-sm text-destructive">{errorMessage}</div>}

        <DialogFooter className="px-6 pb-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            取消
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isPending ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

export function UnifiedEditDialog(props: UnifiedEditDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <UnifiedEditDialogInner key={props.user.id} {...props} /> : null}
    </Dialog>
  );
}

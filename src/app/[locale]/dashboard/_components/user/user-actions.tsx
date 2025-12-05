"use client";
import { SquarePen, Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormErrorBoundary } from "@/components/form-error-boundary";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { User, UserDisplay } from "@/types/user";
import { DeleteUserConfirm } from "./forms/delete-user-confirm";
import { UserForm } from "./forms/user-form";

interface UserActionsProps {
  user: UserDisplay;
  currentUser?: User;
}

export function UserActions({ user, currentUser }: UserActionsProps) {
  const [openEdit, setOpenEdit] = useState(false);
  const [openDelete, setOpenDelete] = useState(false);
  const t = useTranslations("dashboard.userActions");

  // 权限检查：只有管理员才能编辑用户信息
  const canEditUser = currentUser?.role === "admin";

  // 如果没有权限，不显示任何按钮
  if (!canEditUser) {
    return null;
  }

  return (
    <div className="flex items-center gap-1">
      {/* 编辑用户 */}
      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={t("editAriaLabel")}
            className="inline-flex items-center justify-center p-1 text-muted-foreground hover:text-foreground transition-colors"
            title={t("edit")}
          >
            <SquarePen className="h-3.5 w-3.5" />
          </button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <FormErrorBoundary>
            <UserForm user={user} onSuccess={() => setOpenEdit(false)} currentUser={currentUser} />
          </FormErrorBoundary>
        </DialogContent>
      </Dialog>

      {/* 删除用户 */}
      <Dialog open={openDelete} onOpenChange={setOpenDelete}>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={t("deleteAriaLabel")}
            className="inline-flex items-center justify-center p-1 text-muted-foreground hover:text-red-600 transition-colors"
            title={t("delete")}
          >
            <Trash className="h-3.5 w-3.5" />
          </button>
        </DialogTrigger>
        <DialogContent>
          <FormErrorBoundary>
            <DeleteUserConfirm user={user} onSuccess={() => setOpenDelete(false)} />
          </FormErrorBoundary>
        </DialogContent>
      </Dialog>
    </div>
  );
}

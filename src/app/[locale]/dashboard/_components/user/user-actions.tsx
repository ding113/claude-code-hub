"use client";
import { useState } from "react";
import { SquarePen, Trash } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { UserForm } from "./forms/user-form";
import { DeleteUserConfirm } from "./forms/delete-user-confirm";
import type { UserDisplay, User } from "@/types/user";
import { FormErrorBoundary } from "@/components/form-error-boundary";

interface UserActionsProps {
  user: UserDisplay;
  currentUser?: User;
}

export function UserActions({ user, currentUser }: UserActionsProps) {
  const [openEdit, setOpenEdit] = useState(false);
  const [openDelete, setOpenDelete] = useState(false);

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
            aria-label="编辑用户"
            className="inline-flex items-center justify-center p-1 text-muted-foreground hover:text-foreground transition-colors"
            title="编辑用户"
          >
            <SquarePen className="h-3.5 w-3.5" />
          </button>
        </DialogTrigger>
        <DialogContent>
          <FormErrorBoundary>
            <UserForm user={user} onSuccess={() => setOpenEdit(false)} />
          </FormErrorBoundary>
        </DialogContent>
      </Dialog>

      {/* 删除用户 */}
      <Dialog open={openDelete} onOpenChange={setOpenDelete}>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label="删除用户"
            className="inline-flex items-center justify-center p-1 text-muted-foreground hover:text-red-600 transition-colors"
            title="删除用户"
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

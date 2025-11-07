"use client";
import { useState } from "react";
import { SquarePen, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { EditKeyForm } from "./forms/edit-key-form";
import { DeleteKeyConfirm } from "./forms/delete-key-confirm";
import type { UserKeyDisplay } from "@/types/user";
import type { User } from "@/types/user";
import { FormErrorBoundary } from "@/components/form-error-boundary";

interface KeyActionsProps {
  keyData: UserKeyDisplay;
  currentUser?: User;
  keyOwnerUserId: number; // 这个Key所属的用户ID
  canDelete: boolean;
}

export function KeyActions({ keyData, currentUser, keyOwnerUserId, canDelete }: KeyActionsProps) {
  const [openEdit, setOpenEdit] = useState(false);
  const [openDelete, setOpenDelete] = useState(false);

  // 权限检查：只有管理员或Key的拥有者才能编辑/删除
  const canManageKey =
    currentUser && (currentUser.role === "admin" || currentUser.id === keyOwnerUserId);

  // 如果没有权限，不显示任何操作按钮
  if (!canManageKey) {
    return null;
  }

  return (
    <div className="flex items-center gap-1">
      {/* 编辑Key */}
      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label="编辑密钥"
            className="inline-flex items-center justify-center p-1.5 text-muted-foreground hover:text-foreground transition-colors"
            title="编辑"
          >
            <SquarePen className="h-4 w-4" />
          </button>
        </DialogTrigger>
        <DialogContent>
          <FormErrorBoundary>
            <EditKeyForm keyData={keyData} onSuccess={() => setOpenEdit(false)} />
          </FormErrorBoundary>
        </DialogContent>
      </Dialog>

      {/* 删除Key */}
      {canDelete && (
        <Dialog open={openDelete} onOpenChange={setOpenDelete}>
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label="删除密钥"
              className="inline-flex items-center justify-center p-1.5 text-muted-foreground hover:text-red-600"
              title="删除"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </DialogTrigger>
          <DialogContent>
            <FormErrorBoundary>
              <DeleteKeyConfirm keyData={keyData} onSuccess={() => setOpenDelete(false)} />
            </FormErrorBoundary>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

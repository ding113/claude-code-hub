"use client";
import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDeleteUser } from "@/lib/api-client/v1/users/hooks";

interface DeleteUserConfirmProps {
  user?: {
    id: number;
    name: string;
    keys: { id: number; name: string }[];
  };
}

export function DeleteUserConfirm({
  user,
  onSuccess,
}: DeleteUserConfirmProps & { onSuccess?: () => void }) {
  const { mutateAsync, isPending } = useDeleteUser(user?.id ?? 0);

  const handleConfirm = async () => {
    if (!user) return;
    try {
      await mutateAsync();
      onSuccess?.();
    } catch {
      // useApiMutation already surfaces toast errors via localizeError
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>确认删除用户</DialogTitle>
        <DialogDescription>
          您确定要删除用户 &ldquo;<strong>{user?.name}</strong>&rdquo; 吗？
          <br />
          此操作将同时删除该用户的 {user?.keys.length || 0} 个密钥，且无法撤销。
        </DialogDescription>
      </DialogHeader>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={isPending}>
            取消
          </Button>
        </DialogClose>
        <Button variant="destructive" onClick={handleConfirm} disabled={isPending}>
          {isPending ? "删除中..." : "确认删除"}
        </Button>
      </DialogFooter>
    </>
  );
}

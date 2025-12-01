"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { removeUser } from "@/actions/users";
import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleConfirm = () => {
    if (!user) return;
    startTransition(async () => {
      try {
        const res = await removeUser(user.id);
        if (!res.ok) {
          toast.error(res.error || "删除失败");
          return;
        }
        onSuccess?.();
        router.refresh();
      } catch (error) {
        console.error("删除用户失败:", error);
        toast.error("删除失败，请稍后重试");
      }
    });
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

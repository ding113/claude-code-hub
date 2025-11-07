"use client";
import { useTransition } from "react";
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { removeKey } from "@/actions/keys";
import { toast } from "sonner";

interface DeleteKeyConfirmProps {
  keyData?: {
    id: number;
    name: string;
    maskedKey: string;
  };
}

export function DeleteKeyConfirm({
  keyData,
  onSuccess,
}: DeleteKeyConfirmProps & { onSuccess?: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleConfirm = () => {
    if (!keyData) return;
    startTransition(async () => {
      try {
        const res = await removeKey(keyData.id);
        if (!res.ok) {
          toast.error(res.error || "删除失败");
          return;
        }
        onSuccess?.();
        router.refresh();
      } catch (error) {
        console.error("删除Key失败:", error);
        toast.error("删除失败，请稍后重试");
      }
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>确认删除密钥</DialogTitle>
        <DialogDescription>
          您确定要删除密钥 &ldquo;<strong>{keyData?.name}</strong>&rdquo; 吗？
          <br />
          <code className="bg-muted px-2 py-1 rounded text-xs">{keyData?.maskedKey}</code>
          <br />
          此操作无法撤销，删除后所有使用此密钥的应用将无法访问。
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

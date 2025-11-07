"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Eye } from "lucide-react";
import { getSessionMessages } from "@/actions/active-sessions";
import { useState } from "react";

interface SessionMessagesDialogProps {
  sessionId: string;
}

export function SessionMessagesDialog({ sessionId }: SessionMessagesDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<unknown | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = async () => {
    setIsOpen(true);
    setIsLoading(true);
    setError(null);

    try {
      const result = await getSessionMessages(sessionId);
      if (result.ok) {
        setMessages(result.data);
      } else {
        setError(result.error || "获取失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setMessages(null);
    setError(null);
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (open) {
          void handleOpen();
        } else {
          handleClose();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Eye className="h-4 w-4 mr-1" />
          查看
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Session Messages</DialogTitle>
          <DialogDescription className="font-mono text-xs">{sessionId}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">加载中...</div>
          ) : error ? (
            <div className="text-center py-8 text-destructive">
              {error}
              {error.includes("未存储") && (
                <p className="text-sm text-muted-foreground mt-2">
                  提示：请设置环境变量 STORE_SESSION_MESSAGES=true 以启用 messages 存储
                </p>
              )}
            </div>
          ) : messages ? (
            <div className="rounded-md border bg-muted p-4">
              <pre className="text-xs overflow-x-auto">{JSON.stringify(messages, null, 2)}</pre>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">暂无数据</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { getSessionMessages } from "@/actions/active-sessions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface SessionMessagesDialogProps {
  sessionId: string;
}

export function SessionMessagesDialog({ sessionId }: SessionMessagesDialogProps) {
  const t = useTranslations("dashboard.sessions");
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
        setError(result.error || t("status.fetchFailed"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("status.unknownError"));
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
          {t("actions.view")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("details.title")}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{sessionId}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">{t("status.loading")}</div>
          ) : error ? (
            <div className="text-center py-8 text-destructive">
              {error}
              {error.includes(t("status.storageNotEnabled")) && (
                <p className="text-sm text-muted-foreground mt-2">
                  {t("status.storageNotEnabledHint")}
                </p>
              )}
            </div>
          ) : messages ? (
            <div className="rounded-md border bg-muted p-4">
              <pre className="text-xs overflow-x-auto">{JSON.stringify(messages, null, 2)}</pre>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">{t("details.noData")}</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

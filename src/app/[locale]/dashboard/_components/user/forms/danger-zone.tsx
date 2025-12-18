"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface DangerZoneProps {
  userId: number;
  userName: string;
  onDelete: () => Promise<void>;
  /**
   * i18n strings passed from parent.
   * Expected keys (optional):
   * - title, description
   * - delete.title, delete.description, delete.trigger, delete.confirm
   * - delete.confirmHint (e.g. "Type {name} to confirm")
   * - actions.cancel
   * - errors.deleteFailed
   */
  translations: Record<string, unknown>;
}

function getTranslation(translations: Record<string, unknown>, path: string, fallback: string) {
  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, translations);
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function DangerZone({ userId, userName, onDelete, translations }: DangerZoneProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const canDelete = useMemo(
    () => deleteConfirmText.trim() === userName,
    [deleteConfirmText, userName]
  );

  const handleDelete = async () => {
    setDeleteError(null);
    setIsDeleting(true);
    try {
      await onDelete();
      setDeleteOpen(false);
    } catch (err) {
      console.error("Delete user failed:", { userId, err });
      setDeleteError(
        getTranslation(translations, "errors.deleteFailed", "Operation failed, please try again")
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <header className="space-y-1">
        <h3 className="text-sm font-medium text-destructive">
          {getTranslation(translations, "title", "Danger Zone")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {getTranslation(
            translations,
            "description",
            "The following actions are irreversible, please proceed with caution"
          )}
        </p>
      </header>

      <div className="mt-4 grid gap-3">
        {/* Delete user */}
        <div className="flex flex-col gap-3 rounded-md border border-destructive/20 bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium">
              {getTranslation(translations, "delete.title", "Delete User")}
            </div>
            <div className="text-xs text-muted-foreground">
              {getTranslation(
                translations,
                "delete.description",
                "This will delete all associated data and cannot be undone"
              )}
            </div>
          </div>

          <AlertDialog
            open={deleteOpen}
            onOpenChange={(next) => {
              setDeleteOpen(next);
              if (!next) {
                setDeleteConfirmText("");
                setDeleteError(null);
              }
            }}
          >
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive">
                <Trash2 className="h-4 w-4" />
                {getTranslation(translations, "delete.trigger", "Delete")}
              </Button>
            </AlertDialogTrigger>

            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {getTranslation(translations, "delete.title", "Delete User")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {getTranslation(
                    translations,
                    "delete.confirmDescription",
                    `This will delete user "${userName}" and all associated data. This action cannot be undone.`
                  ).replace("{userName}", userName)}
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="grid gap-2">
                <Label htmlFor="delete-confirm-input">
                  {getTranslation(translations, "delete.confirmLabel", "Confirm")}
                </Label>
                <Input
                  id="delete-confirm-input"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={getTranslation(
                    translations,
                    "delete.confirmHint",
                    `Type "${userName}" to confirm deletion`
                  ).replace("{userName}", userName)}
                  autoComplete="off"
                />
              </div>

              {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}

              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>
                  {getTranslation(translations, "actions.cancel", "Cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    handleDelete();
                  }}
                  disabled={isDeleting || !canDelete}
                  className={cn(buttonVariants({ variant: "destructive" }))}
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {getTranslation(translations, "delete.loading", "Deleting...")}
                    </>
                  ) : (
                    getTranslation(translations, "delete.confirm", "Confirm Delete")
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </section>
  );
}

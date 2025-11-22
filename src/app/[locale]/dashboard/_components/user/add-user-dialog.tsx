"use client";
import { useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ListPlus } from "lucide-react";
import { UserForm } from "./forms/user-form";
import { FormErrorBoundary } from "@/components/form-error-boundary";
import { useTranslations } from "next-intl";

type ButtonProps = ComponentProps<typeof Button>;

interface AddUserDialogProps {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  currentUser?: {
    role: string;
  };
}

export function AddUserDialog({
  variant = "default",
  size = "default",
  className,
  currentUser,
}: AddUserDialogProps) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("dashboard.userList");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          <ListPlus className="h-4 w-4" /> {t("addUser")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] flex flex-col overflow-hidden">
        <FormErrorBoundary>
          <UserForm onSuccess={() => setOpen(false)} currentUser={currentUser} />
        </FormErrorBoundary>
      </DialogContent>
    </Dialog>
  );
}

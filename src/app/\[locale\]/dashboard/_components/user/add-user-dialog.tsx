"use client";
import { useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ListPlus } from "lucide-react";
import { UserForm } from "./forms/user-form";
import { FormErrorBoundary } from "@/components/form-error-boundary";

type ButtonProps = ComponentProps<typeof Button>;

interface AddUserDialogProps {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}

export function AddUserDialog({
  variant = "default",
  size = "default",
  className,
}: AddUserDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          <ListPlus className="h-4 w-4" /> 新增用户
        </Button>
      </DialogTrigger>
      <DialogContent>
        <FormErrorBoundary>
          <UserForm onSuccess={() => setOpen(false)} />
        </FormErrorBoundary>
      </DialogContent>
    </Dialog>
  );
}

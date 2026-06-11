"use client";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { ServerCog } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormErrorBoundary } from "@/components/form-error-boundary";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ProviderForm } from "./forms/provider-form";
import { ProviderFormDialogContent } from "./provider-form-dialog-content";

interface AddProviderDialogProps {
  enableMultiProviderTypes: boolean;
}

export function AddProviderDialog({ enableMultiProviderTypes }: AddProviderDialogProps) {
  const t = useTranslations("settings.providers");
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <ServerCog className="h-4 w-4" /> {t("addProvider")}
        </Button>
      </DialogTrigger>
      <ProviderFormDialogContent className="max-w-full sm:max-w-5xl lg:max-w-6xl">
        <VisuallyHidden>
          <DialogTitle>{t("addProvider")}</DialogTitle>
        </VisuallyHidden>
        <FormErrorBoundary>
          <ProviderForm
            mode="create"
            enableMultiProviderTypes={enableMultiProviderTypes}
            onSuccess={() => {
              setOpen(false);
            }}
          />
        </FormErrorBoundary>
      </ProviderFormDialogContent>
    </Dialog>
  );
}

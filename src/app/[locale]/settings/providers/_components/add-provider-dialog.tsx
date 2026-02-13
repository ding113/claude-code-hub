"use client";
import { useQueryClient } from "@tanstack/react-query";
import { ServerCog } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormErrorBoundary } from "@/components/form-error-boundary";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ProviderForm } from "./forms/provider-form";

interface AddProviderDialogProps {
  enableMultiProviderTypes: boolean;
}

export function AddProviderDialog({ enableMultiProviderTypes }: AddProviderDialogProps) {
  const queryClient = useQueryClient();
  const t = useTranslations("settings.providers");
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <ServerCog className="h-4 w-4" /> {t("addProvider")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-full sm:max-w-5xl lg:max-w-6xl max-h-[90vh] flex flex-col">
        <FormErrorBoundary>
          <ProviderForm
            mode="create"
            enableMultiProviderTypes={enableMultiProviderTypes}
            onSuccess={() => {
              setOpen(false);
              queryClient.invalidateQueries({ queryKey: ["providers"] });
              queryClient.invalidateQueries({ queryKey: ["providers-health"] });
              queryClient.invalidateQueries({ queryKey: ["providers-statistics"] });
              queryClient.invalidateQueries({ queryKey: ["provider-vendors"] });
            }}
          />
        </FormErrorBoundary>
      </DialogContent>
    </Dialog>
  );
}

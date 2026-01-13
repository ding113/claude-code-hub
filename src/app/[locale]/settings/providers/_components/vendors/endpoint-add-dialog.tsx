"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";
import { createProviderEndpointAction } from "@/actions/provider-endpoints";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProviderType } from "@/types/provider";

const formSchema = z.object({
  providerType: z.enum([
    "claude",
    "claude-auth",
    "codex",
    "gemini",
    "gemini-cli",
    "openai-compatible",
  ]),
  baseUrl: z.string().url(),
  priority: z.number().int(),
  weight: z.number().int().min(1),
  isEnabled: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

interface EndpointAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: number;
}

export function EndpointAddDialog({ open, onOpenChange, vendorId }: EndpointAddDialogProps) {
  const t = useTranslations("settings.providers.vendors.endpoints");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  const {
    control,
    handleSubmit,
    formState: { errors },
    reset,
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      providerType: "openai-compatible",
      baseUrl: "",
      priority: 0,
      weight: 1,
      isEnabled: true,
    },
  });

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
      const result = await createProviderEndpointAction({
        vendorId,
        providerType: values.providerType as ProviderType,
        baseUrl: values.baseUrl,
        priority: values.priority,
        weight: values.weight,
        isEnabled: values.isEnabled,
      });

      if (result.ok) {
        toast.success(t("createSuccess"));
        queryClient.invalidateQueries({ queryKey: ["provider-endpoints"] });
        queryClient.invalidateQueries({ queryKey: ["provider-vendors"] });
        onOpenChange(false);
        reset();
      } else {
        if (result.errorCode === "CONFLICT") {
          setError("baseUrl", { message: t("errors.conflict") });
        } else {
          toast.error(result.error || t("errors.createFailed"));
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t("addTitle")}</DialogTitle>
          <DialogDescription>{t("addDescription")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="providerType">{t("fields.type")}</Label>
            <Controller
              control={control}
              name="providerType"
              render={({ field }) => (
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <SelectTrigger id="providerType">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai-compatible">OpenAI Compatible</SelectItem>
                    <SelectItem value="claude">Claude</SelectItem>
                    <SelectItem value="claude-auth">Claude Auth</SelectItem>
                    <SelectItem value="gemini">Gemini</SelectItem>
                    <SelectItem value="gemini-cli">Gemini CLI</SelectItem>
                    <SelectItem value="codex">Codex</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {errors.providerType && (
              <p className="text-sm text-destructive">{errors.providerType.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="baseUrl">{t("fields.baseUrl")}</Label>
            <Controller
              control={control}
              name="baseUrl"
              render={({ field }) => (
                <Input id="baseUrl" placeholder="https://api.example.com/v1" {...field} />
              )}
            />
            {errors.baseUrl && <p className="text-sm text-destructive">{errors.baseUrl.message}</p>}
          </div>

          <div className="flex gap-4">
            <div className="space-y-2 flex-1">
              <Label htmlFor="priority">{t("fields.priority")}</Label>
              <Controller
                control={control}
                name="priority"
                render={({ field }) => (
                  <Input
                    id="priority"
                    type="number"
                    {...field}
                    onChange={(e) => field.onChange(e.target.valueAsNumber)}
                  />
                )}
              />
              {errors.priority && (
                <p className="text-sm text-destructive">{errors.priority.message}</p>
              )}
            </div>

            <div className="space-y-2 flex-1">
              <Label htmlFor="weight">{t("fields.weight")}</Label>
              <Controller
                control={control}
                name="weight"
                render={({ field }) => (
                  <Input
                    id="weight"
                    type="number"
                    min={1}
                    {...field}
                    onChange={(e) => field.onChange(e.target.valueAsNumber)}
                  />
                )}
              />
              {errors.weight && <p className="text-sm text-destructive">{errors.weight.message}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("actions.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { Toaster as Sonner, type ToasterProps, toast } from "sonner";

import { installErrorToastSanitizer } from "@/lib/utils/user-visible-error";

const Toaster = ({ ...props }: ToasterProps) => {
  const t = useTranslations("errors");
  const { theme = "system" } = useTheme();

  useEffect(() => {
    installErrorToastSanitizer(toast, t("INTERNAL_ERROR"));
  }, [t]);

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };

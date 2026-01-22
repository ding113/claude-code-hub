"use client";

import { Radio } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface FloatingProbeButtonProps {
  onProbeComplete?: () => void;
  className?: string;
}

export function FloatingProbeButton({ onProbeComplete, className }: FloatingProbeButtonProps) {
  const t = useTranslations("dashboard.availability.actions");
  const [isProbing, setIsProbing] = useState(false);

  const handleProbeAll = async () => {
    if (isProbing) return;

    setIsProbing(true);
    try {
      // Trigger global probe via API
      const res = await fetch("/api/availability/probe-all", { method: "POST" });
      if (!res.ok) {
        throw new Error("Probe failed");
      }
      toast.success(t("probeSuccess"));
      onProbeComplete?.();
    } catch (error) {
      console.error("Probe all failed:", error);
      toast.error(t("probeFailed"));
    } finally {
      setIsProbing(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleProbeAll}
      disabled={isProbing}
      className={cn(
        "fixed bottom-6 right-6 z-50",
        "flex items-center gap-2 pl-4 pr-5 py-3",
        "bg-primary hover:bg-primary/90 text-primary-foreground",
        "rounded-full shadow-lg",
        "transition-all duration-300 transform",
        "hover:scale-105 hover:shadow-[0_4px_20px_rgba(var(--primary),0.4)]",
        "active:scale-95",
        "disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100",
        "group",
        className
      )}
    >
      <Radio
        className={cn(
          "h-5 w-5 transition-transform duration-500",
          isProbing ? "animate-pulse" : "group-hover:rotate-180"
        )}
      />
      <span className="text-sm font-semibold tracking-wide uppercase">
        {isProbing ? t("probing") : t("probeAll")}
      </span>
    </button>
  );
}

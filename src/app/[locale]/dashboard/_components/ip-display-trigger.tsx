"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface IpDisplayTriggerProps {
  ip: string | null | undefined;
  onClick: () => void;
  className?: string;
  buttonClassName?: string;
  textClassName?: string;
  placeholder?: ReactNode;
  placeholderClassName?: string;
}

export function IpDisplayTrigger({
  ip,
  onClick,
  className,
  buttonClassName,
  textClassName,
  placeholder = "—",
  placeholderClassName,
}: IpDisplayTriggerProps) {
  if (!ip) {
    return (
      <span
        className={cn(
          "block font-mono text-xs text-muted-foreground",
          className,
          placeholderClassName
        )}
      >
        {placeholder}
      </span>
    );
  }

  return (
    <button
      type="button"
      title={ip}
      onClick={onClick}
      data-slot="ip-display-trigger"
      className={cn(
        // 这里固定用满容器宽度并开启 min-w-0，避免长 IPv6 把列宽重新撑开。
        "flex w-full min-w-0 max-w-full cursor-pointer items-center overflow-hidden text-left",
        className,
        buttonClassName
      )}
    >
      <span
        data-slot="ip-display-text"
        className={cn(
          "block min-w-0 max-w-full truncate font-mono text-xs underline decoration-dotted hover:decoration-solid",
          textClassName
        )}
      >
        {ip}
      </span>
    </button>
  );
}

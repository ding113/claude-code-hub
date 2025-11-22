"use client";

import { useEffect, useState } from "react";
import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type ThemeValue = "light" | "dark" | "system";

interface ThemeSwitcherProps {
  className?: string;
  size?: "sm" | "default";
  showLabel?: boolean;
}

export function ThemeSwitcher({
  className,
  size = "sm",
  showLabel = false,
}: ThemeSwitcherProps) {
  const t = useTranslations("common");
  const [mounted, setMounted] = useState(false);

  // Always call useTheme unconditionally (Rules of Hooks requirement)
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Simplified theme options with better type inference
  const options = [
    { value: "light" as ThemeValue, icon: Sun },
    { value: "dark" as ThemeValue, icon: Moon },
    { value: "system" as ThemeValue, icon: Laptop },
  ];

  const labelMap: Record<ThemeValue, string> = {
    light: t("light"),
    dark: t("dark"),
    system: t("system"),
  };

  // Simplified: directly use theme for display (shows "system" when selected)
  const currentTheme = (theme ?? "system") as ThemeValue;

  const triggerSize = size === "sm" ? "icon" : "default";

  // Handle theme changes with error handling
  const handleThemeChange = (value: string) => {
    try {
      setTheme(value as ThemeValue);
    } catch (error) {
      console.error("Failed to change theme:", error);
      // Optionally show toast notification
      // toast.error("Unable to change theme. Please check browser settings.");
    }
  };

  if (!mounted) {
    return (
      <Button
        aria-label={t("theme")}
        variant="ghost"
        size={triggerSize}
        className={cn(
          "relative rounded-full border border-border/60 bg-card/60 text-muted-foreground",
          triggerSize === "icon" && "size-9",
          className
        )}
        disabled
      >
        <Sun className="size-4 animate-pulse opacity-60" />
        {showLabel && <span className="ml-2 text-sm">{t("theme")}</span>}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("theme")}
          variant="ghost"
          size={triggerSize}
          className={cn(
            "relative rounded-full border border-border/60 bg-card/70 text-foreground shadow-xs transition-all duration-200 hover:border-border hover:bg-accent/60 hover:text-accent-foreground",
            triggerSize === "icon" && "size-9",
            showLabel && "min-w-[7.5rem] justify-start gap-2 px-3",
            className
          )}
        >
          <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          {showLabel && (
            <span className="text-sm font-medium leading-none">{labelMap[currentTheme]}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]" sideOffset={8}>
        <DropdownMenuLabel>{t("theme")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={currentTheme}
          onValueChange={handleThemeChange}
          className="pt-1"
        >
          {options.map(({ value, icon: Icon }) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              className="flex items-center gap-2 capitalize"
            >
              <Icon className="size-4" />
              <span>{labelMap[value]}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

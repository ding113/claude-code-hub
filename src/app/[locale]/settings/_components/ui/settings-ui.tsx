"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  Bell,
  Database,
  DollarSign,
  Download,
  FileText,
  Filter,
  FlaskConical,
  HardDrive,
  Link2,
  type LucideIcon,
  Power,
  Settings,
  ShieldAlert,
  Smartphone,
  Trash2,
  TrendingUp,
  Upload,
  Webhook,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Icon name type for serialization across server/client boundary
export type SettingsSectionIconName =
  | "settings"
  | "trash"
  | "database"
  | "hard-drive"
  | "download"
  | "upload"
  | "file-text"
  | "bell"
  | "webhook"
  | "shield-alert"
  | "alert-triangle"
  | "filter"
  | "smartphone"
  | "dollar-sign"
  | "link"
  | "power"
  | "trending-up"
  | "flask-conical";

// Map icon names to components (client-side only)
const SETTINGS_SECTION_ICON_MAP: Record<SettingsSectionIconName, LucideIcon> = {
  settings: Settings,
  trash: Trash2,
  database: Database,
  "hard-drive": HardDrive,
  download: Download,
  upload: Upload,
  "file-text": FileText,
  bell: Bell,
  webhook: Webhook,
  "shield-alert": ShieldAlert,
  "alert-triangle": AlertTriangle,
  filter: Filter,
  smartphone: Smartphone,
  "dollar-sign": DollarSign,
  link: Link2,
  power: Power,
  "trending-up": TrendingUp,
  "flask-conical": FlaskConical,
};

// Glass-morphism section card
interface SettingsSectionProps {
  title: string;
  description?: string;
  icon?: SettingsSectionIconName;
  iconColor?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  variant?: "default" | "highlight" | "warning";
}

export function SettingsSection({
  title,
  description,
  icon,
  iconColor = "text-primary",
  actions,
  children,
  className,
  variant = "default",
}: SettingsSectionProps) {
  const variantStyles = {
    default: "bg-card/30 border-white/5 hover:border-white/10",
    highlight: "bg-primary/5 border-primary/20 hover:border-primary/30",
    warning: "bg-yellow-500/5 border-yellow-500/20 hover:border-yellow-500/30",
  };

  const Icon = icon ? SETTINGS_SECTION_ICON_MAP[icon] : null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={cn(
        "relative overflow-hidden rounded-xl border backdrop-blur-sm p-5 md:p-6 transition-colors duration-200",
        variantStyles[variant],
        className
      )}
    >
      {/* Decorative gradient blob */}
      {variant === "highlight" && (
        <div className="absolute top-0 right-0 w-48 h-48 bg-primary/10 rounded-full blur-3xl pointer-events-none -translate-y-1/2 translate-x-1/2" />
      )}

      <div className="relative z-10">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            {Icon && (
              <div
                className={cn(
                  "flex items-center justify-center w-9 h-9 rounded-lg shrink-0 mt-0.5",
                  variant === "highlight" ? "bg-primary/20" : "bg-white/5"
                )}
              >
                <Icon className={cn("h-4.5 w-4.5", iconColor)} />
              </div>
            )}
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-foreground tracking-tight">{title}</h3>
              {description && (
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{description}</p>
              )}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
        </div>
        {children}
      </div>
    </motion.section>
  );
}

// Toggle row component
interface SettingsToggleRowProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconBgColor?: string;
  iconColor?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function SettingsToggleRow({
  title,
  description,
  icon: Icon,
  iconBgColor = "bg-primary/10",
  iconColor = "text-primary",
  checked,
  onCheckedChange,
  disabled,
}: SettingsToggleRowProps) {
  return (
    <div
      className={cn(
        "p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between gap-4",
        "hover:bg-white/[0.04] hover:border-white/10 transition-colors cursor-pointer",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      onClick={() => !disabled && onCheckedChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          !disabled && onCheckedChange(!checked);
        }
      }}
      role="switch"
      aria-checked={checked}
      tabIndex={disabled ? -1 : 0}
    >
      <div className="flex items-start gap-3 min-w-0">
        {Icon && (
          <div
            className={cn(
              "w-8 h-8 flex items-center justify-center rounded-lg shrink-0",
              iconBgColor
            )}
          >
            <Icon className={cn("h-4 w-4", iconColor)} />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
          )}
        </div>
      </div>
      <label className="relative inline-flex items-center cursor-pointer shrink-0">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          disabled={disabled}
          onClick={(e) => e.stopPropagation()}
        />
        <div
          className={cn(
            "w-10 h-6 rounded-full transition-all duration-200",
            "bg-muted peer-checked:bg-primary",
            "after:content-[''] after:absolute after:top-[2px] after:left-[2px]",
            "after:bg-white after:rounded-full after:h-5 after:w-5",
            "after:transition-all after:duration-200",
            "peer-checked:after:translate-x-4",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-primary/50"
          )}
        />
      </label>
    </div>
  );
}

// Input field component
interface SettingsInputProps {
  label?: string;
  description?: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: "text" | "number" | "password" | "url";
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  disabled?: boolean;
  className?: string;
  mono?: boolean;
}

export function SettingsInput({
  label,
  description,
  value,
  onChange,
  type = "text",
  placeholder,
  prefix,
  suffix,
  disabled,
  className,
  mono,
}: SettingsInputProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </label>
      )}
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
            {prefix}
          </span>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "w-full bg-muted/50 border border-border rounded-lg py-2 px-3 text-sm text-foreground",
            "placeholder:text-muted-foreground/50",
            "focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            prefix && "pl-7",
            suffix && "pr-12",
            mono && "font-mono"
          )}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
            {suffix}
          </span>
        )}
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

// Select field component
interface SettingsSelectProps {
  label?: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  className?: string;
}

export function SettingsSelect({
  label,
  description,
  value,
  onChange,
  options,
  disabled,
  className,
}: SettingsSelectProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            "w-full bg-muted/50 border border-border rounded-lg py-2 px-3 pr-8 text-sm text-foreground",
            "focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "appearance-none cursor-pointer"
          )}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <svg
          className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

// Slider component
interface SettingsSliderProps {
  label?: string;
  description?: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  formatValue?: (value: number) => string;
  marks?: { value: number; label: string }[];
}

export function SettingsSlider({
  label,
  description,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  className,
  formatValue,
  marks,
}: SettingsSliderProps) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className={cn("space-y-3", className)}>
      {(label || formatValue) && (
        <div className="flex items-center justify-between">
          {label && <label className="text-sm font-medium text-foreground">{label}</label>}
          {formatValue && (
            <span className="text-sm font-mono font-semibold text-primary">
              {formatValue(value)}
            </span>
          )}
        </div>
      )}
      <div className="relative pt-1">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          className="w-full h-1.5 bg-transparent appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed relative z-10"
          style={{
            background: `linear-gradient(to right, hsl(var(--primary)) ${percentage}%, hsl(var(--muted)) ${percentage}%)`,
            borderRadius: "9999px",
          }}
        />
        {marks && (
          <div className="flex justify-between mt-2 text-[10px] text-muted-foreground font-mono">
            {marks.map((mark) => (
              <span key={mark.value}>{mark.label}</span>
            ))}
          </div>
        )}
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

// Status badge component
interface SettingsStatusBadgeProps {
  status: "healthy" | "warning" | "error" | "info";
  label: string;
}

export function SettingsStatusBadge({ status, label }: SettingsStatusBadgeProps) {
  const styles = {
    healthy: "bg-green-500/10 text-green-400 border-green-500/20",
    warning: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    error: "bg-red-500/10 text-red-400 border-red-500/20",
    info: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  };

  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border",
        styles[status]
      )}
    >
      {label}
    </span>
  );
}

// Divider component
export function SettingsDivider() {
  return <div className="h-px bg-white/5 w-full my-6" />;
}

// Form actions footer
interface SettingsFormActionsProps {
  onCancel?: () => void;
  onSave?: () => void;
  saveLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  dangerAction?: {
    label: string;
    onClick: () => void;
  };
}

export function SettingsFormActions({
  onCancel,
  onSave,
  saveLabel = "Save Changes",
  cancelLabel = "Cancel",
  loading,
  disabled,
  dangerAction,
}: SettingsFormActionsProps) {
  return (
    <div className="flex items-center justify-between pt-6 border-t border-white/5">
      {dangerAction ? (
        <button
          type="button"
          onClick={dangerAction.onClick}
          className="flex items-center gap-2 px-3 py-2 text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg text-sm font-medium transition-colors"
        >
          {dangerAction.label}
        </button>
      ) : (
        <div />
      )}
      <div className="flex gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground font-medium transition-colors"
          >
            {cancelLabel}
          </button>
        )}
        {onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={disabled || loading}
            className={cn(
              "flex items-center gap-2 px-5 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-bold rounded-lg",
              "shadow-lg shadow-primary/20 transition-all active:scale-95",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
            )}
          >
            {loading && (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            )}
            {saveLabel}
          </button>
        )}
      </div>
    </div>
  );
}

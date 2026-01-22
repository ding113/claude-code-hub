import {
  AlertTriangle,
  Bell,
  Database,
  DollarSign,
  FileText,
  Filter,
  type LucideIcon,
  Settings,
  ShieldAlert,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Icon name type for serialization across server/client boundary
export type PageHeaderIconName =
  | "settings"
  | "database"
  | "file-text"
  | "bell"
  | "shield-alert"
  | "alert-triangle"
  | "filter"
  | "smartphone"
  | "dollar-sign";

// Map icon names to components
const HEADER_ICON_MAP: Record<PageHeaderIconName, LucideIcon> = {
  settings: Settings,
  database: Database,
  "file-text": FileText,
  bell: Bell,
  "shield-alert": ShieldAlert,
  "alert-triangle": AlertTriangle,
  filter: Filter,
  smartphone: Smartphone,
  "dollar-sign": DollarSign,
};

interface SettingsPageHeaderProps {
  title: string;
  description?: string;
  icon?: PageHeaderIconName;
  actions?: React.ReactNode;
}

export function SettingsPageHeader({ title, description, icon, actions }: SettingsPageHeaderProps) {
  const Icon = icon ? HEADER_ICON_MAP[icon] : null;

  return (
    <div className="mb-6 md:mb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          {Icon && (
            <div className="hidden sm:flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 shrink-0">
              <Icon className="h-6 w-6 text-primary" />
            </div>
          )}
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
              {title}
            </h1>
            {description && (
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed max-w-2xl">
                {description}
              </p>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}

// Compact header for sub-sections
interface SettingsSectionHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconColor?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function SettingsSectionHeader({
  title,
  description,
  icon: Icon,
  iconColor = "text-muted-foreground",
  badge,
  actions,
  className,
}: SettingsSectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5",
        className
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        {Icon && (
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/5 shrink-0 mt-0.5">
            <Icon className={cn("h-4 w-4", iconColor)} />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            {badge}
          </div>
          {description && (
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

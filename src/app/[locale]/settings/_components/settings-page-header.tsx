interface SettingsPageHeaderProps {
  title: string;
  description?: string;
}

export function SettingsPageHeader({ title, description }: SettingsPageHeaderProps) {
  return (
    <div className="space-y-1">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

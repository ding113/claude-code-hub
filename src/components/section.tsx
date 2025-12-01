import type React from "react";

export type SectionProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function Section({ title, description, actions, children, className }: SectionProps) {
  return (
    <section
      className={`bg-card text-card-foreground border border-border rounded-xl shadow-sm p-5 ${className ?? ""}`}
    >
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground mt-1">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

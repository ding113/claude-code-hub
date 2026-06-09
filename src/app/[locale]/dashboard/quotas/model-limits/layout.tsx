import { ModelLimitsSubNav } from "./_components/model-limits-sub-nav";

export default function ModelLimitsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <ModelLimitsSubNav />
      <div className="space-y-4">{children}</div>
    </div>
  );
}

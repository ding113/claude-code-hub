"use client";

import { FlaskConical, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getDistinctProviderGroupsAction } from "@/actions/request-filters";
import { simulateSchedulingAction } from "@/actions/scheduling-simulator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import type { SchedulingSimulationResult, SimulationStep } from "@/lib/scheduling-simulator";
import { cn } from "@/lib/utils";

type FormatOption = "claude" | "openai" | "response" | "gemini";

function StepCard({ step, t }: { step: SimulationStep; t: (key: string) => string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasFailed = step.failed.length > 0;
  const passRate =
    step.inputCount > 0 ? ((step.outputCount / step.inputCount) * 100).toFixed(0) : "0";

  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Badge variant="outline" className="text-[10px] shrink-0">
            {t(
              `step${step.name.replace(/_./g, (m) => m[1].toUpperCase()).replace(/^./, (c) => c.toUpperCase())}`
            )}
          </Badge>
          <span className="text-xs text-muted-foreground truncate">{step.description}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-mono">
            {step.inputCount} {"->"} {step.outputCount}
          </span>
          {hasFailed && (
            <Badge variant="destructive" className="text-[10px]">
              -{step.failed.length}
            </Badge>
          )}
          {!hasFailed && step.inputCount > 0 && (
            <Badge
              variant="secondary"
              className="text-[10px] bg-green-600/10 text-green-600 border-green-600/20"
            >
              {passRate}%
            </Badge>
          )}
        </div>
      </button>

      {isExpanded && (step.passed.length > 0 || step.failed.length > 0) && (
        <div className="border-t border-border/40 px-3 py-2 space-y-2 bg-muted/20">
          {step.passed.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                {t("passed")} ({step.passed.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {step.passed.map((p) => (
                  <Badge key={p.id} variant="secondary" className="text-[10px] font-mono">
                    {p.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {step.failed.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                {t("failed")} ({step.failed.length})
              </p>
              <div className="space-y-1">
                {step.failed.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 text-xs rounded bg-destructive/5 px-2 py-1"
                  >
                    <span className="font-mono">{f.name}</span>
                    <Badge variant="outline" className="text-[10px] text-destructive">
                      {t(
                        `reason${f.reason.replace(/_./g, (m) => m[1].toUpperCase()).replace(/^./, (c) => c.toUpperCase())}`
                      )}
                    </Badge>
                    {f.details && (
                      <span className="text-muted-foreground text-[10px]">{f.details}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SchedulingTestDialog() {
  const t = useTranslations("settings.providers.schedulingTest");
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<FormatOption>("claude");
  const [model, setModel] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [availableGroups, setAvailableGroups] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<SchedulingSimulationResult | null>(null);

  useEffect(() => {
    if (!open) return;
    getDistinctProviderGroupsAction().then((res) => {
      if (res.ok) {
        setAvailableGroups(res.data);
      }
    });
  }, [open]);

  const handleRun = async () => {
    if (!model.trim()) return;
    setIsRunning(true);
    setResult(null);

    try {
      const res = await simulateSchedulingAction({
        format,
        model: model.trim(),
        groups,
      });
      if (res.ok) {
        setResult(res.data);
      } else {
        toast.error(res.error);
      }
    } catch {
      toast.error("Simulation failed");
    } finally {
      setIsRunning(false);
    }
  };

  const toggleGroup = (group: string) => {
    setGroups((prev) =>
      prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group]
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FlaskConical className="h-4 w-4" />
          {t("triggerButton")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Input Section */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("formatLabel")}</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as FormatOption)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">{t("formatClaude")}</SelectItem>
                  <SelectItem value="openai">{t("formatOpenAI")}</SelectItem>
                  <SelectItem value="response">{t("formatCodex")}</SelectItem>
                  <SelectItem value="gemini">{t("formatGemini")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("modelLabel")}</Label>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRun()}
                placeholder={t("modelPlaceholder")}
                className="h-9 font-mono text-sm"
              />
            </div>
          </div>

          {/* Groups */}
          {availableGroups.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("groupLabel")}</Label>
              <div className="flex flex-wrap gap-2">
                {availableGroups.map((group) => (
                  <label key={group} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <Checkbox
                      checked={groups.includes(group)}
                      onCheckedChange={() => toggleGroup(group)}
                    />
                    <span className="font-mono">{group}</span>
                  </label>
                ))}
              </div>
              {groups.length === 0 && (
                <p className="text-[10px] text-muted-foreground">{t("groupNoFilter")}</p>
              )}
            </div>
          )}

          <Button onClick={handleRun} disabled={isRunning || !model.trim()} className="w-full">
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("running")}
              </>
            ) : (
              t("runTest")
            )}
          </Button>

          {/* Results */}
          {result && (
            <div className="space-y-4">
              {/* Summary Banner */}
              <div className="rounded-lg bg-muted/50 border border-border/50 px-4 py-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  {t("summaryTitle")}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>
                    {t("totalProviders")}:{" "}
                    <strong className="font-mono">{result.summary.total}</strong>
                  </span>
                  <span>
                    {t("afterGroupFilter")}:{" "}
                    <strong className="font-mono">{result.summary.afterGroup}</strong>
                  </span>
                  <span>
                    {t("afterBasicFilter")}:{" "}
                    <strong className="font-mono">{result.summary.afterBasic}</strong>
                  </span>
                  <span>
                    {t("afterHealthFilter")}:{" "}
                    <strong className="font-mono">{result.summary.afterHealth}</strong>
                  </span>
                  <span className="text-green-600">
                    {t("finalCandidates")}:{" "}
                    <strong className="font-mono">{result.summary.final}</strong>
                  </span>
                </div>
              </div>

              {/* Steps */}
              <div className="space-y-2">
                {result.steps.map((step) => (
                  <StepCard key={step.name} step={step} t={t} />
                ))}
              </div>

              {/* Priority Levels */}
              {result.priorityLevels.length > 0 && (
                <div className="space-y-3">
                  {result.priorityLevels.map((level, idx) => (
                    <div
                      key={level.priority}
                      className={cn(
                        "rounded-lg border px-3 py-2.5",
                        idx === 0
                          ? "border-green-600/30 bg-green-600/5"
                          : "border-border/50 bg-muted/20"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Badge
                          variant={idx === 0 ? "default" : "outline"}
                          className={cn(
                            "text-[10px]",
                            idx === 0 && "bg-green-600 hover:bg-green-600"
                          )}
                        >
                          {t("priorityLevel", { level: level.priority })}
                        </Badge>
                        {idx === 0 && (
                          <span className="text-[10px] text-green-600 font-medium">
                            -- {t("selected")}
                          </span>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {level.providers.map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center gap-2 text-xs rounded bg-background/50 px-2 py-1.5"
                          >
                            <span className="font-mono font-medium flex-1 min-w-0 truncate">
                              {p.name}
                            </span>
                            <Badge variant="outline" className="text-[10px] shrink-0">
                              {t("weight")}: {p.weight}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px] font-mono shrink-0">
                              {(p.probability * 100).toFixed(1)}%
                            </Badge>
                            {p.redirectedModel && (
                              <Badge
                                variant="outline"
                                className="text-[10px] text-amber-600 border-amber-600/30 shrink-0"
                              >
                                {"->"} {p.redirectedModel}
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {result.summary.final === 0 && (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground">{t("noProviders")}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t("noProvidersHint")}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

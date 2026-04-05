"use client";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Loader2,
  Network,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { simulateDispatchAction } from "@/actions/dispatch-simulator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { parseProviderGroups } from "@/lib/utils/provider-group";
import type { DispatchSimulatorResult } from "@/types/dispatch-simulator";
import type { ProviderDisplay } from "@/types/provider";

interface DispatchSimulatorDialogProps {
  providers: ProviderDisplay[];
}

export function DispatchSimulatorDialog({ providers }: DispatchSimulatorDialogProps) {
  const t = useTranslations("settings.providers.dispatchSimulator");

  const [open, setOpen] = useState(false);
  const [clientFormat, setClientFormat] = useState<
    "claude" | "openai" | "response" | "gemini" | "gemini-cli"
  >("claude");
  const [modelName, setModelName] = useState("");
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [result, setResult] = useState<DispatchSimulatorResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSteps, setOpenSteps] = useState<string[]>(["groupFilter", "priorityTiers"]);
  const [isPending, startTransition] = useTransition();

  const groupOptions = useMemo(() => {
    const groups = new Set<string>();
    for (const provider of providers) {
      for (const group of parseProviderGroups(provider.groupTag)) {
        groups.add(group);
      }
    }
    return [...groups].sort((a, b) => a.localeCompare(b));
  }, [providers]);

  const stepSummary = result?.steps ?? [];

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setError(null);
      setResult(null);
    }
  };

  const handleGroupToggle = (group: string, checked: boolean) => {
    setSelectedGroups((current) =>
      checked ? [...current, group] : current.filter((item) => item !== group)
    );
  };

  const handleSimulate = () => {
    setError(null);
    startTransition(async () => {
      const response = await simulateDispatchAction({
        clientFormat,
        modelName,
        groupTags: selectedGroups,
      });

      if (!response.ok) {
        setResult(null);
        setError(response.error || t("genericError"));
        return;
      }

      setResult(response.data);
      setOpenSteps(["groupFilter", "priorityTiers"]);
    });
  };

  const toggleStep = (stepName: string) => {
    setOpenSteps((current) =>
      current.includes(stepName)
        ? current.filter((item) => item !== stepName)
        : [...current, stepName]
    );
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <FlaskConical className="h-4 w-4" />
          {t("button")}
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-[95vw] overflow-y-auto sm:w-[720px]">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-4">
          <div className="rounded-lg border border-border/60 bg-muted/10 p-4">
            <div className="grid gap-4">
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t("protocolLabel")}</p>
                  <Select
                    value={clientFormat}
                    onValueChange={(value) => setClientFormat(value as typeof clientFormat)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="claude">{t("formats.claude")}</SelectItem>
                      <SelectItem value="openai">{t("formats.openai")}</SelectItem>
                      <SelectItem value="response">{t("formats.response")}</SelectItem>
                      <SelectItem value="gemini">{t("formats.gemini")}</SelectItem>
                      <SelectItem value="gemini-cli">{t("formats.geminiCli")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">{t("modelLabel")}</p>
                  <Input
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    onInput={(e) => setModelName((e.target as HTMLInputElement).value)}
                    placeholder={t("modelPlaceholder")}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">{t("groupsLabel")}</p>
                {groupOptions.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {groupOptions.map((group) => {
                      const checked = selectedGroups.includes(group);
                      return (
                        <label
                          key={group}
                          className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) => handleGroupToggle(group, value === true)}
                          />
                          <span>{group}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("noGroups")}</p>
                )}
              </div>

              <div className="flex justify-end">
                <Button type="button" onClick={handleSimulate} disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Network className="mr-2 h-4 w-4" />
                  )}
                  {t("simulateButton")}
                </Button>
              </div>
            </div>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t("errorTitle")}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {result ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {stepSummary.map((step, index) => {
                    const ratio =
                      stepSummary[0].outputCount > 0
                        ? step.outputCount / stepSummary[0].outputCount
                        : 0;
                    return (
                      <div key={step.stepName} className="flex items-center gap-1.5">
                        <div
                          className="rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-center"
                          style={{ opacity: 0.5 + ratio * 0.5 }}
                        >
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {t(`steps.${step.stepName}`)}
                          </div>
                          <div className="text-base font-semibold">{step.outputCount}</div>
                        </div>
                        {index < stepSummary.length - 1 ? (
                          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                {stepSummary.map((step) => {
                  const isOpen = openSteps.includes(step.stepName);
                  return (
                    <Collapsible
                      key={step.stepName}
                      open={isOpen}
                      onOpenChange={() => toggleStep(step.stepName)}
                    >
                      <div className="rounded-lg border border-border/60 bg-background">
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                          >
                            <div>
                              <p className="text-sm font-medium">{t(`steps.${step.stepName}`)}</p>
                              <p className="text-xs text-muted-foreground">
                                {step.inputCount} {"->"} {step.outputCount}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {step.filteredOut.length > 0 ? (
                                <Badge variant="secondary">
                                  {t("filteredCount", { count: step.filteredOut.length })}
                                </Badge>
                              ) : null}
                              {isOpen ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                          </button>
                        </CollapsibleTrigger>

                        <CollapsibleContent className="space-y-3 border-t border-border/50 px-4 py-3">
                          {step.note ? (
                            <p className="text-xs text-muted-foreground">
                              {t(`notes.${step.note}`)}
                            </p>
                          ) : null}

                          <div className="space-y-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {t("surviving")}
                            </p>
                            {step.surviving.length > 0 ? (
                              <div className="space-y-2">
                                {step.surviving.map((provider) => (
                                  <div
                                    key={`${step.stepName}-survive-${provider.id}`}
                                    className="rounded-md border border-border/50 bg-muted/20 px-3 py-2"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="font-medium">{provider.name}</div>
                                      <div className="flex flex-wrap gap-2">
                                        <Badge variant="outline">{provider.providerType}</Badge>
                                        <Badge variant="secondary">
                                          {t("priorityBadge", {
                                            value: provider.effectivePriority,
                                          })}
                                        </Badge>
                                      </div>
                                    </div>
                                    {provider.redirectedModel ? (
                                      <p className="mt-2 text-xs text-muted-foreground">
                                        {t("redirectPreview", { model: provider.redirectedModel })}
                                      </p>
                                    ) : null}
                                    {provider.endpointStats ? (
                                      <p className="mt-2 text-xs text-muted-foreground">
                                        {t("endpointStats", {
                                          total: provider.endpointStats.total,
                                          enabled: provider.endpointStats.enabled,
                                          circuitOpen: provider.endpointStats.circuitOpen,
                                          available: provider.endpointStats.available,
                                        })}
                                      </p>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">{t("none")}</p>
                            )}
                          </div>

                          {step.filteredOut.length > 0 ? (
                            <div className="space-y-2">
                              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {t("filteredOut")}
                              </p>
                              <div className="space-y-2">
                                {step.filteredOut.map((provider) => (
                                  <div
                                    key={`${step.stepName}-filtered-${provider.id}`}
                                    className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="font-medium">{provider.name}</div>
                                      <Badge variant="outline">{provider.providerType}</Badge>
                                    </div>
                                    {provider.details ? (
                                      <p className="mt-2 text-xs text-muted-foreground">
                                        {provider.details}
                                      </p>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                })}
              </div>

              <div className="rounded-lg border border-border/60 bg-muted/10 p-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{t("finalCandidatesTitle")}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("finalCandidatesDescription", {
                          count: result.finalCandidateCount,
                          priority:
                            result.selectedPriority === null ? t("none") : result.selectedPriority,
                        })}
                      </p>
                    </div>
                  </div>

                  {result.priorityTiers.length > 0 ? (
                    <div className="space-y-4">
                      {result.priorityTiers.map((tier) => (
                        <div
                          key={tier.priority}
                          className={`rounded-lg border p-3 ${
                            tier.isSelected
                              ? "border-green-500/40 bg-green-500/5 ring-1 ring-green-500/20 shadow-sm shadow-green-500/10"
                              : "border-border/60 bg-background"
                          }`}
                        >
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <Badge variant={tier.isSelected ? "default" : "secondary"}>
                                {t("tierTitle", { priority: tier.priority })}
                              </Badge>
                              {tier.isSelected ? (
                                <Badge variant="outline">{t("selectedTier")}</Badge>
                              ) : null}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t("tierProviderCount", { count: tier.providers.length })}
                            </div>
                          </div>

                          <div className="space-y-3">
                            {tier.providers.map((provider) => (
                              <div
                                key={provider.id}
                                className="rounded-md border border-border/50 px-3 py-2"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <div className="font-medium">{provider.name}</div>
                                    <Badge variant="outline" className="text-[10px]">
                                      {provider.providerType}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>{t("weightLabel", { weight: provider.weight })}</span>
                                    <Badge variant="outline">
                                      {provider.weightPercent.toFixed(1)}%
                                    </Badge>
                                  </div>
                                </div>
                                <Progress value={provider.weightPercent} className="mt-2 h-1.5" />
                                {provider.redirectedModel || provider.endpointStats ? (
                                  <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                                    {provider.redirectedModel ? (
                                      <span>
                                        {t("redirectPreview", { model: provider.redirectedModel })}
                                      </span>
                                    ) : null}
                                    {provider.endpointStats ? (
                                      <span>
                                        {t("endpointStats", {
                                          total: provider.endpointStats.total,
                                          enabled: provider.endpointStats.enabled,
                                          circuitOpen: provider.endpointStats.circuitOpen,
                                          available: provider.endpointStats.available,
                                        })}
                                      </span>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>{t("noCandidatesTitle")}</AlertTitle>
                      <AlertDescription>{t("noCandidatesDescription")}</AlertDescription>
                    </Alert>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

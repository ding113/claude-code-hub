"use client";

import { ChevronDown, ChevronRight, Info, Lightbulb } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ScenarioStep {
  step: string;
  description: string;
  example: {
    before: string;
    after: string;
    decision: string;
  };
}

// Helper function to build scenarios from translations
function useScenarios() {
  const t = useTranslations("settings.providers.guide");

  return [
    {
      title: t("scenario1Title"),
      emoji: "🎯",
      description: t("scenario1Desc"),
      steps: [
        {
          step: t("scenario1Step1"),
          description: t("scenario1Step1Desc"),
          example: {
            before: t("scenario1Step1Before"),
            after: t("scenario1Step1After"),
            decision: t("scenario1Step1Decision"),
          },
        },
        {
          step: t("scenario1Step2"),
          description: t("scenario1Step2Desc"),
          example: {
            before: t("scenario1Step2Before"),
            after: t("scenario1Step2After"),
            decision: t("scenario1Step2Decision"),
          },
        },
        {
          step: t("scenario1Step3"),
          description: t("scenario1Step3Desc"),
          example: {
            before: t("scenario1Step3Before"),
            after: t("scenario1Step3After"),
            decision: t("scenario1Step3Decision"),
          },
        },
      ],
    },
    {
      title: t("scenario2Title"),
      emoji: "👥",
      description: t("scenario2Desc"),
      steps: [
        {
          step: t("scenario2Step1"),
          description: t("scenario2Step1Desc"),
          example: {
            before: t("scenario2Step1Before"),
            after: t("scenario2Step1After"),
            decision: t("scenario2Step1Decision"),
          },
        },
        {
          step: t("scenario2Step2"),
          description: t("scenario2Step2Desc"),
          example: {
            before: t("scenario2Step2Before"),
            after: t("scenario2Step2After"),
            decision: t("scenario2Step2Decision"),
          },
        },
      ],
    },
    {
      title: t("scenario3Title"),
      emoji: "🛡️",
      description: t("scenario3Desc"),
      steps: [
        {
          step: t("scenario3Step1"),
          description: t("scenario3Step1Desc"),
          example: {
            before: t("scenario3Step1Before"),
            after: t("scenario3Step1After"),
            decision: t("scenario3Step1Decision"),
          },
        },
        {
          step: t("scenario3Step2"),
          description: t("scenario3Step2Desc"),
          example: {
            before: t("scenario3Step2Before"),
            after: t("scenario3Step2After"),
            decision: t("scenario3Step2Decision"),
          },
        },
        {
          step: t("scenario3Step3"),
          description: t("scenario3Step3Desc"),
          example: {
            before: t("scenario3Step3Before"),
            after: t("scenario3Step3After"),
            decision: t("scenario3Step3Decision"),
          },
        },
      ],
    },
    {
      title: t("scenario4Title"),
      emoji: "🔄",
      description: t("scenario4Desc"),
      steps: [
        {
          step: t("scenario4Step1"),
          description: t("scenario4Step1Desc"),
          example: {
            before: t("scenario4Step1Before"),
            after: t("scenario4Step1After"),
            decision: t("scenario4Step1Decision"),
          },
        },
        {
          step: t("scenario4Step2"),
          description: t("scenario4Step2Desc"),
          example: {
            before: t("scenario4Step2Before"),
            after: t("scenario4Step2After"),
            decision: t("scenario4Step2Decision"),
          },
        },
      ],
    },
  ];
}

interface ScenarioCardProps {
  title: string;
  emoji: string;
  description: string;
  steps: ScenarioStep[];
}

function ScenarioCard({ title, emoji, description, steps }: ScenarioCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const t = useTranslations("settings.providers.guide");

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border rounded-lg">
      <CollapsibleTrigger asChild>
        <button className="flex items-center justify-between w-full p-4 hover:bg-muted/50 transition-colors">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{emoji}</span>
            <div className="text-left">
              <h3 className="font-semibold text-base">{title}</h3>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          </div>
          {isOpen ? (
            <ChevronDown className="h-5 w-5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 pb-4 space-y-3">
          {steps.map((step, index) => (
            <div key={index} className="border-l-2 border-primary/30 pl-4 space-y-2">
              <div className="flex items-baseline gap-2">
                <Badge variant="outline" className="shrink-0">
                  {t("step")} {index + 1}
                </Badge>
                <span className="font-medium text-sm">{step.step}</span>
              </div>
              <p className="text-sm text-muted-foreground">{step.description}</p>
              <div className="bg-muted/50 rounded-md p-3 space-y-1.5 text-xs">
                <div>
                  <span className="font-medium">{t("before")}</span>
                  <span className="text-muted-foreground"> {step.example.before}</span>
                </div>
                <div>
                  <span className="font-medium">{t("after")}</span>
                  <span className="text-muted-foreground"> {step.example.after}</span>
                </div>
                <div className="pt-1 border-t border-border/50">
                  <span className="font-medium text-primary">{t("decision")}</span>
                  <span className="text-foreground"> {step.example.decision}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function SchedulingRulesDialog() {
  const t = useTranslations("settings.providers.schedulingDialog");
  const tGuide = useTranslations("settings.providers.guide");
  const scenarios = useScenarios();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Info className="h-4 w-4" />
          {t("triggerButton")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Lightbulb className="h-5 w-5 text-primary" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>{tGuide("title")}</AlertTitle>
            <AlertDescription className="space-y-1 text-sm">
              <p>{tGuide("priorityFirst")}</p>
              <p>{tGuide("costOptimize")}</p>
              <p>{tGuide("healthFilter")}</p>
              <p>{tGuide("sessionReuse")}</p>
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground">
              {tGuide("scenariosTitle")}
            </h3>
            {scenarios.map((scenario, index) => (
              <ScenarioCard key={index} {...scenario} />
            ))}
          </div>

          <Alert variant="default" className="bg-primary/5 border-primary/20">
            <Lightbulb className="h-4 w-4 text-primary" />
            <AlertTitle className="text-primary">{tGuide("bestPracticesTitle")}</AlertTitle>
            <AlertDescription className="space-y-1 text-sm text-foreground">
              <p>{tGuide("bestPracticesPriority")}</p>
              <p>{tGuide("bestPracticesWeight")}</p>
              <p>{tGuide("bestPracticesCost")}</p>
              <p>{tGuide("bestPracticesLimit")}</p>
              <p>{tGuide("bestPracticesConcurrent")}</p>
            </AlertDescription>
          </Alert>
        </div>
      </DialogContent>
    </Dialog>
  );
}

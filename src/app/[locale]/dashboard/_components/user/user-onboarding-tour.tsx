"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface UserOnboardingTourProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

const TOTAL_STEPS = 4;

export function UserOnboardingTour({ open, onOpenChange, onComplete }: UserOnboardingTourProps) {
  const t = useTranslations("dashboard.userManagement.onboarding");
  const [currentStep, setCurrentStep] = useState(0);

  const handleNext = () => {
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleSkip = () => {
    setCurrentStep(0);
    onOpenChange(false);
    onComplete();
  };

  const handleComplete = () => {
    setCurrentStep(0);
    onOpenChange(false);
    onComplete();
  };

  const stepKeys = ["welcome", "limits", "groups", "keyFeatures"] as const;
  const currentStepKey = stepKeys[currentStep];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t(`steps.${currentStepKey}.title`)}</DialogTitle>
          <DialogDescription className="text-base leading-relaxed pt-2">
            {t(`steps.${currentStepKey}.description`)}
          </DialogDescription>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 py-4">
          {stepKeys.map((_, index) => (
            <div
              key={index}
              className={cn(
                "h-2 w-2 rounded-full transition-colors",
                index === currentStep
                  ? "bg-primary"
                  : index < currentStep
                    ? "bg-primary/50"
                    : "bg-muted"
              )}
            />
          ))}
        </div>
        <div className="text-center text-sm text-muted-foreground">
          {t("stepIndicator", { current: currentStep + 1, total: TOTAL_STEPS })}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            onClick={handleSkip}
            className="order-3 sm:order-1 sm:mr-auto"
          >
            {t("skip")}
          </Button>
          <div className="flex gap-2 order-1 sm:order-2">
            {currentStep > 0 && (
              <Button type="button" variant="outline" onClick={handlePrev}>
                {t("prev")}
              </Button>
            )}
            <Button type="button" onClick={handleNext}>
              {currentStep === TOTAL_STEPS - 1 ? t("finish") : t("next")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

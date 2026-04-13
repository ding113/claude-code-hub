"use client";

import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface RuleTesterDialogTriggerProps {
  title: string;
  description: string;
  tooltip?: string;
  label?: string;
  disabled?: boolean;
  children: ReactNode;
}

export function RuleTesterDialogTrigger({
  title,
  description,
  tooltip,
  label,
  disabled = false,
  children,
}: RuleTesterDialogTriggerProps) {
  const triggerText = label ?? title;
  const tooltipText = tooltip ?? title;

  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              data-rule-tester-trigger
              className="h-8 gap-2"
            >
              <Search className="h-3.5 w-3.5" />
              <span>{triggerText}</span>
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>

      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

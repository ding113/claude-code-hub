"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowRight } from "lucide-react";

interface ModelDisplayWithRedirectProps {
  originalModel: string | null;
  currentModel: string | null;
}

export function ModelDisplayWithRedirect({
  originalModel,
  currentModel,
}: ModelDisplayWithRedirectProps) {
  // 判断是否发生重定向
  const isRedirected =
    originalModel && currentModel && originalModel !== currentModel;

  if (!isRedirected) {
    return <span>{currentModel || originalModel || "-"}</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <span>{originalModel}</span>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="cursor-help text-xs border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300"
            >
              <ArrowRight className="h-3 w-3 mr-1" />
              已重定向
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs space-y-1">
              <div>
                <span className="font-medium">目标模型:</span> {currentModel}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

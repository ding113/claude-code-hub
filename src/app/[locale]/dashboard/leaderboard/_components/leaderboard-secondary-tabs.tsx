"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LeaderboardPrimaryTab, LeaderboardSecondaryTab } from "./leaderboard-tab-groups";

interface LeaderboardSecondaryTabLabels {
  cost: string;
  cacheHit: string;
}

interface LeaderboardSecondaryTabsProps {
  activePrimaryTab: LeaderboardPrimaryTab;
  activeSecondaryTab: LeaderboardSecondaryTab | null;
  onSecondaryChange: (tab: LeaderboardSecondaryTab) => void;
  labels: LeaderboardSecondaryTabLabels;
}

export function LeaderboardSecondaryTabs({
  activePrimaryTab,
  activeSecondaryTab,
  onSecondaryChange,
  labels,
}: LeaderboardSecondaryTabsProps) {
  if (activePrimaryTab === "model") {
    return null;
  }

  return (
    <Tabs
      value={activeSecondaryTab ?? "cost"}
      onValueChange={(value) => onSecondaryChange(value as LeaderboardSecondaryTab)}
    >
      <TabsList data-testid="leaderboard-secondary-tabs" className="grid w-full grid-cols-2">
        <TabsTrigger data-testid="leaderboard-secondary-tab-cost" value="cost">
          {labels.cost}
        </TabsTrigger>
        <TabsTrigger data-testid="leaderboard-secondary-tab-cache-hit" value="cacheHit">
          {labels.cacheHit}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

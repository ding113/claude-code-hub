"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LeaderboardPrimaryTab } from "./leaderboard-tab-groups";

interface LeaderboardPrimaryTabLabels {
  user: string;
  provider: string;
  model: string;
}

interface LeaderboardPrimaryTabsProps {
  isAdmin: boolean;
  activePrimaryTab: LeaderboardPrimaryTab;
  onPrimaryChange: (tab: LeaderboardPrimaryTab) => void;
  labels: LeaderboardPrimaryTabLabels;
}

export function LeaderboardPrimaryTabs({
  isAdmin,
  activePrimaryTab,
  onPrimaryChange,
  labels,
}: LeaderboardPrimaryTabsProps) {
  return (
    <Tabs
      value={activePrimaryTab}
      onValueChange={(value) => onPrimaryChange(value as LeaderboardPrimaryTab)}
    >
      <TabsList
        data-testid="leaderboard-primary-tabs"
        className={isAdmin ? "grid w-full grid-cols-3" : "w-full"}
      >
        <TabsTrigger data-testid="leaderboard-primary-tab-user" value="user">
          {labels.user}
        </TabsTrigger>
        {isAdmin ? (
          <TabsTrigger data-testid="leaderboard-primary-tab-provider" value="provider">
            {labels.provider}
          </TabsTrigger>
        ) : null}
        {isAdmin ? (
          <TabsTrigger data-testid="leaderboard-primary-tab-model" value="model">
            {labels.model}
          </TabsTrigger>
        ) : null}
      </TabsList>
    </Tabs>
  );
}

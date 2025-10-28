"use client";
import { Globe } from "lucide-react";
import type { ProviderDisplay } from "@/types/provider";
import type { User } from "@/types/user";
import { ProviderListItem } from "./provider-list-item";
import type { CurrencyCode } from "@/lib/utils/currency";
import { useState, useMemo } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProviderListProps {
  providers: ProviderDisplay[];
  currentUser?: User;
  healthStatus: Record<
    number,
    {
      circuitState: "closed" | "open" | "half-open";
      failureCount: number;
      lastFailureTime: number | null;
      circuitOpenUntil: number | null;
      recoveryMinutes: number | null;
    }
  >;
  currencyCode?: CurrencyCode;
  enableMultiProviderTypes: boolean;
}

export function ProviderList({
  providers,
  currentUser,
  healthStatus,
  currencyCode = "USD",
  enableMultiProviderTypes,
}: ProviderListProps) {
  const [filterType, setFilterType] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("priority");

  // 过滤和排序逻辑
  const filteredAndSortedProviders = useMemo(() => {
    // 先过滤
    let filtered = providers;
    if (filterType !== "all") {
      filtered = providers.filter((p) => p.providerType === filterType);
    }

    // 再排序
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "priority":
          // 优先级相同按权重，权重相同按倍率低优先，都相同按修改时间
          if (a.priority !== b.priority) {
            return a.priority - b.priority; // 数字小的优先级高
          }
          if (a.weight !== b.weight) {
            return b.weight - a.weight; // 权重大的优先
          }
          if (a.costMultiplier !== b.costMultiplier) {
            return a.costMultiplier - b.costMultiplier; // 倍率低的优先
          }
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        case "created-asc":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "created-desc":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "updated-asc":
          return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        case "updated-desc":
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        default:
          return 0;
      }
    });

    return sorted;
  }, [providers, filterType, sortBy]);

  if (providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
          <Globe className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="font-medium text-foreground mb-1">暂无服务商配置</h3>
        <p className="text-sm text-muted-foreground text-center">添加你的第一个 API 服务商</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 过滤和排序控件 */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 space-y-2">
          <Label htmlFor="filter-type">按类型筛选</Label>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger id="filter-type">
              <SelectValue placeholder="选择供应商类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型 ({providers.length})</SelectItem>
              <SelectItem value="claude">
                Claude ({providers.filter((p) => p.providerType === "claude").length})
              </SelectItem>
              <SelectItem value="codex">
                Codex ({providers.filter((p) => p.providerType === "codex").length})
              </SelectItem>
              <SelectItem value="gemini-cli">
                Gemini CLI ({providers.filter((p) => p.providerType === "gemini-cli").length})
              </SelectItem>
              <SelectItem value="openai-compatible">
                OpenAI Compatible (
                {providers.filter((p) => p.providerType === "openai-compatible").length})
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 space-y-2">
          <Label htmlFor="sort-by">排序方式</Label>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger id="sort-by">
              <SelectValue placeholder="选择排序方式" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="priority">
                优先级（高 → 低，相同权重、倍率、更新时间）
              </SelectItem>
              <SelectItem value="created-desc">创建时间（新 → 旧）</SelectItem>
              <SelectItem value="created-asc">创建时间（旧 → 新）</SelectItem>
              <SelectItem value="updated-desc">更新时间（新 → 旧）</SelectItem>
              <SelectItem value="updated-asc">更新时间（旧 → 新）</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 供应商列表 */}
      {filteredAndSortedProviders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 px-4">
          <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
            <Globe className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="font-medium text-foreground mb-1">没有找到匹配的服务商</h3>
          <p className="text-sm text-muted-foreground text-center">
            尝试调整筛选条件或添加新的服务商
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredAndSortedProviders.map((provider) => (
            <ProviderListItem
              key={provider.id}
              item={provider}
              currentUser={currentUser}
              healthStatus={healthStatus[provider.id]}
              currencyCode={currencyCode}
              enableMultiProviderTypes={enableMultiProviderTypes}
            />
          ))}
        </div>
      )}
    </div>
  );
}

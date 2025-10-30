"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RefreshCw, Search } from "lucide-react";

interface QuotaToolbarProps {
  onSearch?: (query: string) => void;
  onSort?: (sortBy: string) => void;
  onFilter?: (filter: string) => void;
  sortOptions?: { value: string; label: string }[];
  filterOptions?: { value: string; label: string }[];
  showSearch?: boolean;
  showSort?: boolean;
  showFilter?: boolean;
  showAutoRefresh?: boolean;
}

export function QuotaToolbar({
  onSearch,
  onSort,
  onFilter,
  sortOptions = [
    { value: "name", label: "按名称" },
    { value: "usage", label: "按使用率" },
  ],
  filterOptions = [
    { value: "all", label: "全部" },
    { value: "warning", label: "接近限额" },
    { value: "exceeded", label: "已超限" },
  ],
  showSearch = true,
  showSort = true,
  showFilter = true,
  showAutoRefresh = true,
}: QuotaToolbarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [searchQuery, setSearchQuery] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30);

  // 自动刷新机制
  useEffect(() => {
    if (!autoRefresh) return;

    const timer = setInterval(() => {
      startTransition(() => {
        router.refresh();
      });
    }, refreshInterval * 1000);

    return () => clearInterval(timer);
  }, [autoRefresh, refreshInterval, router]);

  // 手动刷新
  const handleManualRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  // 搜索处理
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    onSearch?.(value);
  };

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 items-center gap-2">
        {/* 搜索框 */}
        {showSearch && (
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>
        )}

        {/* 筛选器 */}
        {showFilter && onFilter && (
          <Select defaultValue="all" onValueChange={onFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="筛选" />
            </SelectTrigger>
            <SelectContent>
              {filterOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* 排序 */}
        {showSort && onSort && (
          <Select defaultValue="name" onValueChange={onSort}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="排序" />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* 刷新控制 */}
      <div className="flex items-center gap-4">
        {showAutoRefresh && (
          <>
            <div className="flex items-center gap-2">
              <Switch
                id="auto-refresh"
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
              />
              <Label htmlFor="auto-refresh" className="text-sm cursor-pointer">
                自动刷新
              </Label>
            </div>

            {autoRefresh && (
              <Select
                value={refreshInterval.toString()}
                onValueChange={(value) => setRefreshInterval(Number(value))}
              >
                <SelectTrigger className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10秒</SelectItem>
                  <SelectItem value="30">30秒</SelectItem>
                  <SelectItem value="60">60秒</SelectItem>
                </SelectContent>
              </Select>
            )}
          </>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={handleManualRefresh}
          disabled={isPending}
        >
          <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
          <span className="ml-2">刷新</span>
        </Button>
      </div>
    </div>
  );
}

"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUpDown } from "lucide-react";

export type SortOption = 
  | "created_asc"
  | "created_desc" 
  | "updated_asc"
  | "updated_desc"
  | "priority_asc"
  | "priority_desc";

interface ProviderSortSelectProps {
  value: SortOption;
  onValueChange: (value: SortOption) => void;
}

export function ProviderSortSelect({ value, onValueChange }: ProviderSortSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-48">
        <ArrowUpDown className="h-4 w-4 mr-2" />
        <SelectValue placeholder="选择排序方式" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="created_asc">按创建时间正序</SelectItem>
        <SelectItem value="created_desc">按创建时间倒序</SelectItem>
        <SelectItem value="updated_asc">按更新时间正序</SelectItem>
        <SelectItem value="updated_desc">按更新时间倒序</SelectItem>
        <SelectItem value="priority_asc">按优先级由低到高</SelectItem>
        <SelectItem value="priority_desc">按优先级由高到底</SelectItem>
      </SelectContent>
    </Select>
  );
}
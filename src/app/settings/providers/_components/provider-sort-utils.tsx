import type { ProviderDisplay } from "@/types/provider";
import type { SortOption } from "./provider-sort-select";

export function sortProviders(providers: ProviderDisplay[], sortBy: SortOption): ProviderDisplay[] {
  const sorted = [...providers];
  
  switch (sortBy) {
    case "created_asc":
      return sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    
    case "created_desc":
      return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    case "updated_asc":
      return sorted.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
    
    case "updated_desc":
      return sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    
    case "priority_asc":
      return sorted.sort((a, b) => {
        // 优先级数字越小优先级越高
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        // 优先级相同时，costMultiplier越高优先级��高
        if (a.costMultiplier !== b.costMultiplier) {
          return b.costMultiplier - a.costMultiplier;
        }
        // costMultiplier也相同时，权重越高优先级越高
        return a.weight - b.weight;
      });
    
    case "priority_desc":
      return sorted.sort((a, b) => {
        // 优先级数字越大优先级越低（倒序）
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        // 优先级相同时，costMultiplier越低优先级越高（倒序）
        if (a.costMultiplier !== b.costMultiplier) {
          return a.costMultiplier - b.costMultiplier;
        }
        // costMultiplier也相同时，权重越高优先级越高（倒序）
        return b.weight - a.weight;
      });
    
    default:
      return sorted;
  }
}
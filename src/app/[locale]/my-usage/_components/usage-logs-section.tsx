"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useTransition } from "react";
import { getMyAvailableModels, getMyUsageLogs, type MyUsageLogsResult } from "@/actions/my-usage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UsageLogsTable } from "./usage-logs-table";

interface UsageLogsSectionProps {
  initialData?: MyUsageLogsResult | null;
}

interface Filters {
  startDate?: string;
  endDate?: string;
  model?: string;
  statusCode?: number;
  page?: number;
}

export function UsageLogsSection({ initialData = null }: UsageLogsSectionProps) {
  const t = useTranslations("myUsage.logs");
  const [models, setModels] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>({ page: 1 });
  const [data, setData] = useState<MyUsageLogsResult | null>(initialData);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadModels = async () => {
      const result = await getMyAvailableModels();
      if (result.ok && result.data) {
        setModels(result.data);
      }
    };
    loadModels();
  }, []);

  const loadLogs = useCallback(
    (resetPage = false) => {
      startTransition(async () => {
        const nextFilters = resetPage ? { ...filters, page: 1 } : filters;
        const result = await getMyUsageLogs(nextFilters);
        if (result.ok && result.data) {
          setData(result.data);
          setFilters(nextFilters);
          setError(null);
        } else {
          setError(!result.ok && "error" in result ? result.error : t("loadFailed"));
        }
      });
    },
    [filters, t]
  );

  useEffect(() => {
    // initial load if not provided
    if (!initialData) {
      loadLogs(true);
    }
  }, [initialData, loadLogs]);

  const handleFilterChange = (changes: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...changes, page: 1 }));
  };

  const handleApply = () => loadLogs(true);

  const handleReset = () => {
    setFilters({ page: 1 });
    loadLogs(true);
  };

  const handlePageChange = (page: number) => {
    setFilters((prev) => ({ ...prev, page }));
    startTransition(async () => {
      const result = await getMyUsageLogs({ ...filters, page });
      if (result.ok && result.data) {
        setData(result.data);
        setError(null);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label>{t("filters.startDate")}</Label>
            <Input
              type="date"
              value={filters.startDate ?? ""}
              onChange={(e) => handleFilterChange({ startDate: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("filters.endDate")}</Label>
            <Input
              type="date"
              value={filters.endDate ?? ""}
              onChange={(e) => handleFilterChange({ endDate: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("filters.model")}</Label>
            <Select
              value={filters.model ?? ""}
              onValueChange={(value) => handleFilterChange({ model: value || undefined })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("filters.allModels")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("filters.allModels")}</SelectItem>
                {models.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("filters.status")}</Label>
            <Select
              value={filters.statusCode?.toString() ?? ""}
              onValueChange={(value) =>
                handleFilterChange({ statusCode: value ? parseInt(value, 10) : undefined })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t("filters.allStatus")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("filters.allStatus")}</SelectItem>
                <SelectItem value="200">200</SelectItem>
                <SelectItem value="400">400</SelectItem>
                <SelectItem value="401">401</SelectItem>
                <SelectItem value="429">429</SelectItem>
                <SelectItem value="500">500</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleApply} disabled={isPending}>
            {t("filters.apply")}
          </Button>
          <Button size="sm" variant="outline" onClick={handleReset} disabled={isPending}>
            {t("filters.reset")}
          </Button>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <UsageLogsTable
          logs={data?.logs ?? []}
          total={data?.total ?? 0}
          page={filters.page ?? 1}
          pageSize={data?.pageSize ?? 20}
          onPageChange={handlePageChange}
          currencyCode={data?.currencyCode}
        />
      </CardContent>
    </Card>
  );
}

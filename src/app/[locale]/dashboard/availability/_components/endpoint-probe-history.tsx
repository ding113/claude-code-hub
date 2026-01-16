"use client";

import { Activity, CheckCircle2, Play, RefreshCw, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getProviderVendors, probeProviderEndpoint } from "@/actions/provider-endpoints";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/utils/error-messages";
import type {
  ProviderEndpoint,
  ProviderEndpointProbeLog,
  ProviderType,
  ProviderVendor,
} from "@/types/provider";

const PROVIDER_TYPES: ProviderType[] = [
  "claude",
  "claude-auth",
  "codex",
  "gemini-cli",
  "gemini",
  "openai-compatible",
];

export function EndpointProbeHistory() {
  const t = useTranslations("dashboard.availability");
  const tErrors = useTranslations("errors");

  const [vendors, setVendors] = useState<ProviderVendor[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState<string>("");
  const [selectedType, setSelectedType] = useState<ProviderType | "">("");

  const [endpoints, setEndpoints] = useState<ProviderEndpoint[]>([]);
  const [selectedEndpointId, setSelectedEndpointId] = useState<string>("");
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);

  const [logs, setLogs] = useState<ProviderEndpointProbeLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [probing, setProbing] = useState(false);

  useEffect(() => {
    getProviderVendors().then(setVendors).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedVendorId || !selectedType) {
      setEndpoints([]);
      setSelectedEndpointId("");
      return;
    }

    setLoadingEndpoints(true);
    const params = new URLSearchParams({
      vendorId: selectedVendorId,
      providerType: selectedType,
    });

    fetch(`/api/availability/endpoints?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.endpoints) {
          setEndpoints(data.endpoints);
          setSelectedEndpointId((prev) =>
            prev && !data.endpoints.some((e: ProviderEndpoint) => e.id.toString() === prev)
              ? ""
              : prev
          );
        }
      })
      .catch(console.error)
      .finally(() => setLoadingEndpoints(false));
  }, [selectedVendorId, selectedType]);

  const fetchLogs = useCallback(async () => {
    if (!selectedEndpointId) {
      setLogs([]);
      return;
    }

    setLoadingLogs(true);
    try {
      const params = new URLSearchParams({
        endpointId: selectedEndpointId,
        limit: "50",
      });
      const res = await fetch(`/api/availability/endpoints/probe-logs?${params.toString()}`);
      const data = await res.json();
      if (data.logs) {
        setLogs(data.logs);
      }
    } catch (error) {
      console.error("Failed to fetch logs", error);
    } finally {
      setLoadingLogs(false);
    }
  }, [selectedEndpointId]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleProbe = async () => {
    if (!selectedEndpointId) return;

    setProbing(true);
    try {
      const result = await probeProviderEndpoint({
        endpointId: Number.parseInt(selectedEndpointId, 10),
        timeoutMs: 10000,
      });

      if (result.ok) {
        toast.success(t("probeHistory.probeSuccess"));
        fetchLogs();
      } else {
        toast.error(
          result.errorCode
            ? getErrorMessage(tErrors, result.errorCode)
            : t("probeHistory.probeFailed")
        );
      }
    } catch (_error) {
      toast.error(t("probeHistory.probeFailed"));
    } finally {
      setProbing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          {t("probeHistory.title")}
        </CardTitle>
        <CardDescription>{t("probeHistory.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col sm:flex-row gap-4 items-end sm:items-center flex-wrap">
          <div className="space-y-2 min-w-[200px] flex-1">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              {t("probeHistory.selectVendor")}
            </label>
            <Select value={selectedVendorId} onValueChange={setSelectedVendorId}>
              <SelectTrigger>
                <SelectValue placeholder={t("probeHistory.selectVendor")} />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id.toString()}>
                    {v.displayName || v.websiteDomain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 min-w-[200px] flex-1">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              {t("probeHistory.selectType")}
            </label>
            <Select value={selectedType} onValueChange={(v) => setSelectedType(v as ProviderType)}>
              <SelectTrigger>
                <SelectValue placeholder={t("probeHistory.selectType")} />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 min-w-[200px] flex-1">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              {t("probeHistory.selectEndpoint")}
            </label>
            <Select
              value={selectedEndpointId}
              onValueChange={setSelectedEndpointId}
              disabled={loadingEndpoints || endpoints.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    endpoints.length === 0
                      ? t("probeHistory.noEndpoints")
                      : t("probeHistory.selectEndpoint")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {endpoints.map((e) => (
                  <SelectItem key={e.id} value={e.id.toString()}>
                    {e.label || e.url}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 pb-0.5">
            <Button
              variant="outline"
              size="icon"
              onClick={fetchLogs}
              disabled={loadingLogs || !selectedEndpointId}
            >
              <RefreshCw className={cn("h-4 w-4", loadingLogs && "animate-spin")} />
            </Button>

            <Button onClick={handleProbe} disabled={probing || !selectedEndpointId}>
              <Play className="h-4 w-4 mr-2" />
              {probing ? t("probeHistory.probing") : t("probeHistory.probeNow")}
            </Button>
          </div>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("probeHistory.columns.time")}</TableHead>
                <TableHead>{t("probeHistory.columns.status")}</TableHead>
                <TableHead>{t("probeHistory.columns.latency")}</TableHead>
                <TableHead>{t("probeHistory.columns.error")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    {loadingLogs ? t("states.loading") : t("states.noData")}
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-mono text-xs">
                      {new Date(log.createdAt).toLocaleString()}
                      <div className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wider">
                        {t(`probeHistory.${log.source === "manual" ? "manual" : "auto"}`)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {log.ok ? (
                        <Badge
                          variant="outline"
                          className="bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800"
                        >
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          {log.statusCode || 200}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800"
                        >
                          <XCircle className="w-3 h-3 mr-1" />
                          {log.statusCode ?? t("status.unknown")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono">
                      {log.latencyMs ? `${log.latencyMs}ms` : "-"}
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate text-xs text-muted-foreground">
                      {log.errorMessage || "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

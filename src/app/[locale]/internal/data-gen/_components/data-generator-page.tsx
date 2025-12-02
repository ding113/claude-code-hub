"use client";

import { AlertCircle, Download, FileDown, Loader2, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { GeneratorResult, UserBreakdownResult } from "@/lib/data-generator/types";

export function DataGeneratorPage() {
  const t = useTranslations("internal.dataGenerator");
  const [mode, setMode] = useState<"usage" | "userBreakdown">("usage");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [serviceName, setServiceName] = useState<string>("");
  const [totalCostCny, setTotalCostCny] = useState<string>("");
  const [totalRecords, setTotalRecords] = useState<string>("");
  const [models, setModels] = useState<string>("");
  const [userIds, setUserIds] = useState<string>("");
  const [providerIds, setProviderIds] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratorResult | null>(null);
  const [userBreakdownResult, setUserBreakdownResult] = useState<UserBreakdownResult | null>(null);
  const [showParams, setShowParams] = useState(true);
  const [collapseByUser, setCollapseByUser] = useState(true); // 默认折叠

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setUserBreakdownResult(null);

    try {
      const payload: Record<string, unknown> = {
        mode,
        startDate,
        endDate,
      };

      if (mode === "userBreakdown") {
        payload.serviceName = serviceName;
      }

      if (totalCostCny) {
        payload.totalCostCny = parseFloat(totalCostCny);
      }
      if (totalRecords) {
        payload.totalRecords = parseInt(totalRecords, 10);
      }
      if (models) {
        payload.models = models
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean);
      }
      if (userIds) {
        payload.userIds = userIds
          .split(",")
          .map((id) => parseInt(id.trim(), 10))
          .filter(Number.isInteger);
      }
      if (providerIds) {
        payload.providerIds = providerIds
          .split(",")
          .map((id) => parseInt(id.trim(), 10))
          .filter(Number.isInteger);
      }

      const response = await fetch("/api/internal/data-gen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t("errors.failed"));
      }

      if (mode === "userBreakdown") {
        const data: UserBreakdownResult = await response.json();
        setUserBreakdownResult(data);
      } else {
        const data: GeneratorResult = await response.json();
        setResult(data);
      }
      setShowParams(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleExportPDF = async () => {
    const html2canvas = (await import("html2canvas")).default;
    const { jsPDF } = await import("jspdf");

    const element = document.getElementById("export-content");
    if (!element) return;

    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
    });

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({
      orientation: canvas.width > canvas.height ? "landscape" : "portrait",
      unit: "px",
      format: [canvas.width, canvas.height],
    });

    pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
    pdf.save(`data-generator-${new Date().toISOString().split("T")[0]}.pdf`);
  };

  const handleExportScreenshot = async () => {
    const html2canvas = (await import("html2canvas")).default;

    const element = document.getElementById("export-content");
    if (!element) return;

    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
    });

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `data-generator-${new Date().toISOString().split("T")[0]}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  // 折叠后的用户数据（按用户聚合）
  const collapsedUserData = useMemo(() => {
    if (!userBreakdownResult || !collapseByUser) return null;

    const userMap = new Map<
      string,
      {
        userName: string;
        serviceName: string;
        models: Set<string>;
        totalCalls: number;
        totalCost: number;
      }
    >();

    for (const item of userBreakdownResult.items) {
      const existing = userMap.get(item.userName);
      if (existing) {
        existing.models.add(item.model);
        existing.totalCalls += item.totalCalls;
        existing.totalCost += item.totalCost;
      } else {
        userMap.set(item.userName, {
          userName: item.userName,
          serviceName: item.serviceName,
          models: new Set([item.model]),
          totalCalls: item.totalCalls,
          totalCost: item.totalCost,
        });
      }
    }

    return Array.from(userMap.values())
      .map((user) => ({
        userName: user.userName,
        serviceModel: `${user.serviceName} - ${Array.from(user.models).join("、")}`,
        totalCalls: user.totalCalls,
        totalCost: user.totalCost,
      }))
      .sort((a, b) => b.totalCost - a.totalCost);
  }, [userBreakdownResult, collapseByUser]);

  return (
    <div className="space-y-6 p-6">
      <Tabs value={mode} onValueChange={(v) => setMode(v as "usage" | "userBreakdown")}>
        <TabsList>
          <TabsTrigger value="usage">{t("tabs.usage")}</TabsTrigger>
          <TabsTrigger value="userBreakdown">{t("tabs.userBreakdown")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {!showParams && (result || userBreakdownResult) && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setShowParams(true)}>
            <Settings className="mr-2 h-4 w-4" />
            {t("actions.reconfigure")}
          </Button>
        </div>
      )}

      {showParams && (
        <Card>
          <CardHeader>
            <CardTitle>{t("params.title")}</CardTitle>
            <CardDescription>{t("params.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">
                  {t("params.startDate")} {t("params.required")}
                </Label>
                <Input
                  id="startDate"
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">
                  {t("params.endDate")} {t("params.required")}
                </Label>
                <Input
                  id="endDate"
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="totalCostCny">{t("params.totalCostCny")}</Label>
                <Input
                  id="totalCostCny"
                  type="number"
                  placeholder={t("params.placeholders.totalCostCny")}
                  value={totalCostCny}
                  onChange={(e) => setTotalCostCny(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="totalRecords">{t("params.totalRecords")}</Label>
                <Input
                  id="totalRecords"
                  type="number"
                  placeholder={t("params.placeholders.totalRecords")}
                  value={totalRecords}
                  onChange={(e) => setTotalRecords(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="models">{t("params.models")}</Label>
                <Input
                  id="models"
                  placeholder={t("params.placeholders.models")}
                  value={models}
                  onChange={(e) => setModels(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="userIds">{t("params.userIds")}</Label>
                <Input
                  id="userIds"
                  placeholder={t("params.placeholders.userIds")}
                  value={userIds}
                  onChange={(e) => setUserIds(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="providerIds">{t("params.providerIds")}</Label>
                <Input
                  id="providerIds"
                  placeholder={t("params.placeholders.providerIds")}
                  value={providerIds}
                  onChange={(e) => setProviderIds(e.target.value)}
                />
              </div>
              {mode === "userBreakdown" && (
                <div className="space-y-2">
                  <Label htmlFor="serviceName">{t("params.serviceName")}</Label>
                  <Input
                    id="serviceName"
                    placeholder={t("params.placeholders.serviceName")}
                    value={serviceName}
                    onChange={(e) => setServiceName(e.target.value)}
                  />
                </div>
              )}
            </div>

            <Button onClick={handleGenerate} disabled={loading || !startDate || !endDate}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("actions.generate")}
            </Button>
          </CardContent>
        </Card>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <div id="export-content" className="space-y-6">
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={handleExportScreenshot}>
              <Download className="mr-2 h-4 w-4" />
              {t("actions.exportScreenshot")}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF}>
              <FileDown className="mr-2 h-4 w-4" />
              {t("actions.exportPDF")}
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("summary.totalRecords")}</CardDescription>
                <CardTitle className="text-2xl">
                  {result.summary.totalRecords.toLocaleString()}
                </CardTitle>
              </CardHeader>
            </Card>
            {/* <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("summary.totalCost")}</CardDescription>
                <CardTitle className="text-2xl">${result.summary.totalCost.toFixed(4)}</CardTitle>
              </CardHeader>
            </Card> */}
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("summary.totalCostCny")}</CardDescription>
                <CardTitle className="text-2xl">
                  ¥{(result.summary.totalCost * 7.1).toFixed(2)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("summary.totalTokens")}</CardDescription>
                <CardTitle className="text-2xl">
                  {result.summary.totalTokens.toLocaleString()}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("table.usageLogs.title")}</CardTitle>
              <CardDescription>
                {t("table.usageLogs.description", { count: result.logs.length })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border max-h-[600px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>{t("table.usageLogs.columns.time")}</TableHead>
                      <TableHead>{t("table.usageLogs.columns.user")}</TableHead>
                      <TableHead>{t("table.usageLogs.columns.key")}</TableHead>
                      <TableHead>{t("table.usageLogs.columns.provider")}</TableHead>
                      <TableHead>{t("table.usageLogs.columns.model")}</TableHead>
                      <TableHead className="text-right">
                        {t("table.usageLogs.columns.input")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("table.usageLogs.columns.output")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("table.usageLogs.columns.cacheWrite")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("table.usageLogs.columns.cacheRead")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("table.usageLogs.columns.cost")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("table.usageLogs.columns.duration")}
                      </TableHead>
                      <TableHead>{t("table.usageLogs.columns.status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-mono text-xs">
                          {log.createdAt.toLocaleString("zh-CN")}
                        </TableCell>
                        <TableCell>{log.userName}</TableCell>
                        <TableCell className="font-mono text-xs">{log.keyName}</TableCell>
                        <TableCell>{log.providerName}</TableCell>
                        <TableCell className="font-mono text-xs">{log.model}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {log.inputTokens.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {log.outputTokens.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {log.cacheCreationInputTokens > 0
                            ? log.cacheCreationInputTokens.toLocaleString()
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {log.cacheReadInputTokens > 0
                            ? log.cacheReadInputTokens.toLocaleString()
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          ${parseFloat(log.costUsd).toFixed(6)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {log.durationMs >= 1000
                            ? `${(log.durationMs / 1000).toFixed(2)}s`
                            : `${log.durationMs}ms`}
                        </TableCell>
                        <TableCell>
                          {log.statusCode === 200 ? (
                            <span className="inline-flex items-center rounded-md bg-green-100 dark:bg-green-950 px-2 py-1 text-xs font-medium text-green-700 dark:text-green-300">
                              {t("status.success")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-md bg-red-100 dark:bg-red-950 px-2 py-1 text-xs font-medium text-red-700 dark:text-red-300">
                              {log.statusCode}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {userBreakdownResult && (
        <div id="export-content" className="space-y-6">
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={handleExportScreenshot}>
              <Download className="mr-2 h-4 w-4" />
              {t("actions.exportScreenshot")}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF}>
              <FileDown className="mr-2 h-4 w-4" />
              {t("actions.exportPDF")}
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("summary.timeRange")}</CardDescription>
                <CardTitle className="text-sm">
                  <div>
                    {new Date(startDate).toLocaleString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  <div className="text-muted-foreground text-xs">{t("summary.to")}</div>
                  <div>
                    {new Date(endDate).toLocaleString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("summary.uniqueUsers")}</CardDescription>
                <CardTitle className="text-2xl">
                  {userBreakdownResult.summary.uniqueUsers.toLocaleString()}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("summary.totalCalls")}</CardDescription>
                <CardTitle className="text-2xl">
                  {userBreakdownResult.summary.totalCalls.toLocaleString()}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("summary.totalCostCny")}</CardDescription>
                <CardTitle className="text-2xl">
                  ¥{(userBreakdownResult.summary.totalCost * 7.1).toFixed(2)}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{t("table.userBreakdown.title")}</CardTitle>
                  <CardDescription>
                    {t("table.userBreakdown.description", {
                      count: collapseByUser
                        ? (collapsedUserData?.length ?? 0)
                        : userBreakdownResult.items.length,
                    })}
                  </CardDescription>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="collapse-mode"
                    checked={collapseByUser}
                    onCheckedChange={setCollapseByUser}
                  />
                  <Label htmlFor="collapse-mode" className="cursor-pointer">
                    {t("table.userBreakdown.collapseByUser")}
                  </Label>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border max-h-[600px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>{t("table.userBreakdown.columns.userName")}</TableHead>
                      {!collapseByUser && (
                        <TableHead>{t("table.userBreakdown.columns.key")}</TableHead>
                      )}
                      <TableHead>{t("table.userBreakdown.columns.serviceModel")}</TableHead>
                      <TableHead className="text-right">
                        {t("table.userBreakdown.columns.totalCalls")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("table.userBreakdown.columns.totalCost")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {collapseByUser
                      ? collapsedUserData?.map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{item.userName}</TableCell>
                            <TableCell className="font-mono text-xs">{item.serviceModel}</TableCell>
                            <TableCell className="text-right">
                              {item.totalCalls.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              ¥{(item.totalCost * 7.1).toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))
                      : userBreakdownResult.items.map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{item.userName}</TableCell>
                            <TableCell className="font-mono text-xs">{item.keyName}</TableCell>
                            <TableCell className="font-mono text-xs">
                              {item.serviceName} - {item.model}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.totalCalls.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              ¥{(item.totalCost * 7.1).toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

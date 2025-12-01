"use client";
import { AlertCircle, Check, CheckCircle2, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { previewProxyUrls } from "@/app/v1/_lib/url";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface UrlPreviewProps {
  baseUrl: string;
  providerType?: string;
}

/**
 * URL 预览组件
 *
 * 根据用户输入的 base_url 和供应商类型，实时显示对应端点的拼接结果
 *
 * **功能**：
 * - 根据供应商类型展示对应的 API 端点完整 URL
 * - 智能检测路径是否已包含在 base_url 中（高亮显示）
 * - 提供一键复制功能
 * - 验证 URL 合法性
 *
 * **解决问题**：
 * - Issue #139: 用户填写 base_url 时不知道最终会拼接成什么样
 * - 帮助用户避免配置错误（如重复路径）
 */
export function UrlPreview({ baseUrl, providerType }: UrlPreviewProps) {
  const t = useTranslations("settings.providers.form.urlPreview");
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // 实时生成预览结果
  const previews = useMemo(() => {
    if (!baseUrl || baseUrl.trim() === "") {
      return null;
    }

    try {
      return previewProxyUrls(baseUrl, providerType);
    } catch {
      return null;
    }
  }, [baseUrl, providerType]);

  // 检测 URL 是否包含重复路径（基础启发式检测）
  const detectDuplicatePath = (url: string): boolean => {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;

      // 检测重复的路径段（如 /responses/v1/responses）
      const segments = path.split("/").filter(Boolean);
      const duplicates = segments.filter((seg, idx) => segments.indexOf(seg) !== idx);

      return duplicates.length > 0;
    } catch {
      return false;
    }
  };

  // 复制 URL 到剪贴板
  const copyToClipboard = async (url: string, name: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      toast.success(t("copySuccess", { name }));

      // 3 秒后重置复制状态
      setTimeout(() => setCopiedUrl(null), 3000);
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  // 如果没有输入 base_url，不显示预览
  if (!baseUrl || baseUrl.trim() === "") {
    return null;
  }

  // 如果 URL 解析失败
  if (!previews) {
    return (
      <Card className="p-4 border-orange-200 bg-orange-50">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-orange-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium text-orange-900">{t("invalidUrl")}</p>
            <p className="text-xs text-orange-700">{t("invalidUrlDesc")}</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 border-blue-200 bg-blue-50">
      <div className="space-y-3">
        {/* 标题 */}
        <div className="flex items-start gap-2">
          <CheckCircle2 className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-blue-900">{t("title")}</p>
          </div>
        </div>

        {/* 预览列表 */}
        <div className="space-y-2">
          {Object.entries(previews).map(([name, url]) => {
            const hasDuplicate = detectDuplicatePath(url);
            const isCopied = copiedUrl === url;

            return (
              <div
                key={name}
                className={`rounded-md border p-3 bg-white ${
                  hasDuplicate ? "border-orange-300" : "border-blue-200"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {/* 端点名称 */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-slate-700">{name}</span>
                      {hasDuplicate && (
                        <Badge variant="outline" className="text-orange-600 border-orange-300">
                          {t("duplicatePath")}
                        </Badge>
                      )}
                    </div>

                    {/* 完整 URL */}
                    <code className="text-xs text-slate-600 break-all block">{url}</code>
                  </div>

                  {/* 复制按钮 */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 flex-shrink-0"
                    onClick={() => copyToClipboard(url, name)}
                    title={t("copy")}
                  >
                    {isCopied ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4 text-slate-500" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

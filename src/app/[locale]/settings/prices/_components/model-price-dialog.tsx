"use client";

import { Loader2, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { upsertSingleModelPrice } from "@/actions/model-prices";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ModelPrice } from "@/types/model-price";

interface ModelPriceDialogProps {
  mode: "create" | "edit";
  initialData?: ModelPrice;
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

type ModelMode = "chat" | "image_generation" | "completion";

/**
 * 模型价格添加/编辑对话框
 */
export function ModelPriceDialog({ mode, initialData, trigger, onSuccess }: ModelPriceDialogProps) {
  const t = useTranslations("settings.prices");
  const tCommon = useTranslations("settings.common");

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // 表单状态
  const [modelName, setModelName] = useState("");
  const [modelMode, setModelMode] = useState<ModelMode>("chat");
  const [provider, setProvider] = useState("");
  const [inputPrice, setInputPrice] = useState("");
  const [outputPrice, setOutputPrice] = useState("");

  // 当对话框打开或初始数据变化时，重置表单
  useEffect(() => {
    if (open) {
      if (mode === "edit" && initialData) {
        setModelName(initialData.modelName);
        setModelMode((initialData.priceData.mode as ModelMode) || "chat");
        setProvider(initialData.priceData.litellm_provider || "");
        // 将每 token 价格转换为每百万 token 价格显示
        setInputPrice(
          initialData.priceData.input_cost_per_token
            ? (initialData.priceData.input_cost_per_token * 1000000).toString()
            : ""
        );
        if (initialData.priceData.mode === "image_generation") {
          setOutputPrice(
            initialData.priceData.output_cost_per_image
              ? initialData.priceData.output_cost_per_image.toString()
              : ""
          );
        } else {
          setOutputPrice(
            initialData.priceData.output_cost_per_token
              ? (initialData.priceData.output_cost_per_token * 1000000).toString()
              : ""
          );
        }
      } else {
        // 创建模式，清空表单
        setModelName("");
        setModelMode("chat");
        setProvider("");
        setInputPrice("");
        setOutputPrice("");
      }
    }
  }, [open, mode, initialData]);

  const handleSubmit = async () => {
    // 验证
    if (!modelName.trim()) {
      toast.error(t("form.modelNameRequired"));
      return;
    }

    setLoading(true);

    try {
      // 将每百万 token 价格转换回每 token 价格
      const inputCostPerToken = inputPrice ? parseFloat(inputPrice) / 1000000 : undefined;
      const outputCostPerToken =
        modelMode !== "image_generation" && outputPrice
          ? parseFloat(outputPrice) / 1000000
          : undefined;
      const outputCostPerImage =
        modelMode === "image_generation" && outputPrice ? parseFloat(outputPrice) : undefined;

      const result = await upsertSingleModelPrice({
        modelName: modelName.trim(),
        mode: modelMode,
        litellmProvider: provider.trim() || undefined,
        inputCostPerToken,
        outputCostPerToken,
        outputCostPerImage,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(mode === "create" ? t("toast.createSuccess") : t("toast.updateSuccess"));
      setOpen(false);
      onSuccess?.();
      window.dispatchEvent(new Event("price-data-updated"));
    } catch (error) {
      console.error("保存失败:", error);
      toast.error(t("toast.saveFailed"));
    } finally {
      setLoading(false);
    }
  };

  const defaultTrigger =
    mode === "create" ? (
      <Button variant="outline" size="sm">
        <Plus className="h-4 w-4 mr-2" />
        {t("addModel")}
      </Button>
    ) : (
      <Button variant="ghost" size="sm">
        <Pencil className="h-4 w-4 mr-2" />
        {t("actions.edit")}
      </Button>
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger || defaultTrigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? t("addModel") : t("editModel")}</DialogTitle>
          <DialogDescription>
            {mode === "create" ? t("addModelDescription") : t("editModelDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 模型名称 */}
          <div className="space-y-2">
            <Label htmlFor="modelName">{t("form.modelName")}</Label>
            <Input
              id="modelName"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder={t("form.modelNamePlaceholder")}
              disabled={mode === "edit" || loading}
            />
          </div>

          {/* 类型 */}
          <div className="space-y-2">
            <Label htmlFor="modelMode">{t("form.type")}</Label>
            <Select
              value={modelMode}
              onValueChange={(value: ModelMode) => setModelMode(value)}
              disabled={loading}
            >
              <SelectTrigger id="modelMode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chat">{t("table.typeChat")}</SelectItem>
                <SelectItem value="image_generation">{t("table.typeImage")}</SelectItem>
                <SelectItem value="completion">{t("table.typeCompletion")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 供应商 */}
          <div className="space-y-2">
            <Label htmlFor="provider">{t("form.provider")}</Label>
            <Input
              id="provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder={t("form.providerPlaceholder")}
              disabled={loading}
            />
          </div>

          {/* 输入价格 */}
          {modelMode !== "image_generation" && (
            <div className="space-y-2">
              <Label htmlFor="inputPrice">{t("form.inputPrice")}</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <Input
                  id="inputPrice"
                  type="number"
                  min="0"
                  step="any"
                  value={inputPrice}
                  onChange={(e) => setInputPrice(e.target.value)}
                  placeholder="0.00"
                  className="pl-7 pr-12"
                  disabled={loading}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  /M
                </span>
              </div>
            </div>
          )}

          {/* 输出价格 */}
          <div className="space-y-2">
            <Label htmlFor="outputPrice">
              {modelMode === "image_generation"
                ? t("form.outputPriceImage")
                : t("form.outputPrice")}
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                $
              </span>
              <Input
                id="outputPrice"
                type="number"
                min="0"
                step="any"
                value={outputPrice}
                onChange={(e) => setOutputPrice(e.target.value)}
                placeholder="0.00"
                className="pl-7 pr-16"
                disabled={loading}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                {modelMode === "image_generation" ? "/img" : "/M"}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {tCommon("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

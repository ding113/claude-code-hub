"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  createQuotaBoost,
  deleteQuotaBoost,
  listQuotaBoosts,
  type QuotaBoostGrantResponse,
} from "@/lib/api-client/v1/actions/quota-boosts";
import type { CurrencyCode } from "@/lib/utils/currency";
import { CURRENCY_CONFIG } from "@/lib/utils/currency";

type BoostWindow = "5h" | "daily" | "weekly" | "monthly" | "total";

const BOOST_WINDOWS: BoostWindow[] = ["5h", "daily", "weekly", "monthly", "total"];

interface QuotaBoostPanelProps {
  userId: number;
  userName: string;
  modelGroupId: number;
  modelGroupName: string;
  currencyCode?: CurrencyCode;
  onChanged?: () => void;
}

export function QuotaBoostPanel({
  userId,
  modelGroupId,
  currencyCode = "USD",
  onChanged,
}: QuotaBoostPanelProps) {
  const t = useTranslations("quota.quotaBoosts");
  const currencySymbol = CURRENCY_CONFIG[currencyCode]?.symbol ?? "$";

  const [boosts, setBoosts] = useState<QuotaBoostGrantResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  const [window, setWindow] = useState<BoostWindow>("daily");
  const [amount, setAmount] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadBoosts = useCallback(async () => {
    setLoading(true);
    const result = await listQuotaBoosts({ userId, modelGroupId });
    if (result.ok) {
      setBoosts(result.data);
    } else {
      toast.error(result.error ?? t("errors.list_failed"));
    }
    setLoading(false);
  }, [userId, modelGroupId, t]);

  useEffect(() => {
    void loadBoosts();
  }, [loadBoosts]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsedAmount = Number.parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error(t("invalidAmount"));
      return;
    }
    if (!validFrom || !validTo) {
      toast.error(t("validityRequired"));
      return;
    }
    if (new Date(validTo) <= new Date(validFrom)) {
      toast.error(t("errors.invalid_validity_range"));
      return;
    }

    setSubmitting(true);
    // The datetime-local input yields a zoneless "YYYY-MM-DDTHH:mm" string, but the API
    // requires ISO 8601 with a timezone offset. Interpret it as local wall-clock time and
    // serialize to a UTC instant so the grant activates at the moment the admin picked.
    const result = await createQuotaBoost({
      userId,
      modelGroupId,
      window,
      amountUsd: parsedAmount,
      validFrom: new Date(validFrom).toISOString(),
      validTo: new Date(validTo).toISOString(),
      note: note.trim() || null,
    });
    setSubmitting(false);

    if (result.ok) {
      toast.success(t("createSuccess"));
      setAmount("");
      setValidFrom("");
      setValidTo("");
      setNote("");
      await loadBoosts();
      onChanged?.();
    } else {
      toast.error(result.error ?? t("errors.create_failed"));
    }
  };

  const handleDelete = (id: number) => {
    startTransition(async () => {
      const result = await deleteQuotaBoost(id);
      if (result.ok) {
        toast.success(t("deleteSuccess"));
        await loadBoosts();
        onChanged?.();
      } else {
        toast.error(result.error ?? t("errors.delete_failed"));
      }
    });
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t("note")}</p>

      <form onSubmit={handleCreate} className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="grid gap-1.5">
          <Label className="text-xs">{t("window")}</Label>
          <Select value={window} onValueChange={(v: BoostWindow) => setWindow(v)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOOST_WINDOWS.map((w) => (
                <SelectItem key={w} value={w}>
                  {t(`window_${w}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">
            {t("amount")} ({currencySymbol})
          </Label>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="h-9"
            required
          />
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("validFrom")}</Label>
          <Input
            type="datetime-local"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            className="h-9"
            required
          />
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("validTo")}</Label>
          <Input
            type="datetime-local"
            value={validTo}
            onChange={(e) => setValidTo(e.target.value)}
            className="h-9"
            required
          />
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("note_label")}</Label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("notePlaceholder")}
            className="h-9"
            maxLength={500}
          />
        </div>

        <div className="flex items-end">
          <Button type="submit" size="sm" disabled={submitting} className="h-9">
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            {t("addBoost")}
          </Button>
        </div>
      </form>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : boosts.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("noBoosts")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.window")}</TableHead>
              <TableHead className="text-right">{t("table.amount")}</TableHead>
              <TableHead>{t("table.validFrom")}</TableHead>
              <TableHead>{t("table.validTo")}</TableHead>
              <TableHead>{t("table.note")}</TableHead>
              <TableHead className="text-right">{t("table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {boosts.map((boost) => (
              <TableRow key={boost.id}>
                <TableCell>{t(`window_${boost.window}`)}</TableCell>
                <TableCell className="text-right">
                  {currencySymbol}
                  {Number(boost.amountUsd).toFixed(2)}
                </TableCell>
                <TableCell className="text-sm">{formatDate(boost.validFrom)}</TableCell>
                <TableCell className="text-sm">{formatDate(boost.validTo)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{boost.note ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("revokeConfirm.title")}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("revokeConfirm.description")}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("revokeConfirm.cancel")}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(boost.id)}>
                            {t("revokeConfirm.confirm")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

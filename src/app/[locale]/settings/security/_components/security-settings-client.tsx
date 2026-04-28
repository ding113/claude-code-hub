"use client";

import { QRCode } from "antd";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Section } from "@/components/section";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface TotpStatus {
  enabled: boolean;
  boundAt: string | null;
}

interface TotpSetup {
  secret: string;
  otpauthUri: string;
  expiresAt: string;
}

interface TotpEnableResponse {
  enabled: boolean;
  boundAt: string;
}

export function SecuritySettingsClient() {
  const t = useTranslations("settings.security");
  const [status, setStatus] = useState<TotpStatus>({ enabled: false, boundAt: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableOtpCode, setDisableOtpCode] = useState("");

  const loadTotpStatus = useCallback(async (): Promise<TotpStatus> => {
    const response = await fetch("/api/account/security/totp");
    if (!response.ok) throw new Error("load failed");
    const data = (await response.json()) as TotpStatus;
    return { enabled: Boolean(data.enabled), boundAt: data.boundAt ?? null };
  }, []);

  useEffect(() => {
    let active = true;

    void loadTotpStatus()
      .then((data) => {
        if (!active) return;
        setStatus(data);
      })
      .catch(() => {
        if (active) toast.error(t("loadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loadTotpStatus, t]);

  const startSetup = async () => {
    setSaving(true);
    setOtpCode("");

    try {
      const response = await fetch("/api/account/security/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setup" }),
      });

      if (!response.ok) throw new Error("setup failed");

      const data = (await response.json()) as TotpSetup;
      setSetup(data);
      setSetupOpen(true);
    } catch {
      toast.error(t("setupFailed"));
    } finally {
      setSaving(false);
    }
  };

  const enableTotp = async () => {
    if (!setup || !/^\d{6}$/.test(otpCode)) return;
    setSaving(true);

    try {
      const latestStatus = await loadTotpStatus();
      setStatus(latestStatus);
      if (latestStatus.enabled) {
        setSetupOpen(false);
        setSetup(null);
        setOtpCode("");
        toast.error(t("statusChanged"));
        return;
      }

      const response = await fetch("/api/account/security/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "enable",
          otpCode,
        }),
      });

      if (!response.ok) {
        toast.error(t("invalidCode"));
        return;
      }

      const data = (await response.json()) as TotpEnableResponse;
      setStatus({ enabled: true, boundAt: data.boundAt });
      setSetupOpen(false);
      setSetup(null);
      setOtpCode("");
      toast.success(t("enabled"));
    } catch {
      toast.error(t("enableFailed"));
    } finally {
      setSaving(false);
    }
  };

  const disableTotp = async () => {
    if (!/^\d{6}$/.test(disableOtpCode)) return;
    setSaving(true);

    try {
      const response = await fetch("/api/account/security/totp", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otpCode: disableOtpCode }),
      });

      if (!response.ok) {
        toast.error(t("invalidCode"));
        return;
      }

      setStatus({ enabled: false, boundAt: null });
      setDisableOpen(false);
      setDisableOtpCode("");
      toast.success(t("disabled"));
    } catch {
      toast.error(t("disableFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (checked: boolean) => {
    if (checked) {
      void startSetup();
    } else {
      setDisableOtpCode("");
      setDisableOpen(true);
    }
  };

  return (
    <>
      <Section title={t("totp.title")} description={t("totp.description")} icon="shield-alert">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              {status.enabled ? (
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
              ) : (
                <ShieldOff className="h-4 w-4 text-muted-foreground" />
              )}
              <span>{status.enabled ? t("status.enabled") : t("status.disabled")}</span>
            </div>
            {status.boundAt ? (
              <p className="text-xs text-muted-foreground">
                {t("status.boundAt", { date: new Date(status.boundAt).toLocaleString() })}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            {loading || saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <Switch
              checked={status.enabled}
              disabled={loading || saving}
              onCheckedChange={handleToggle}
              aria-label={t("totp.toggle")}
            />
          </div>
        </div>
      </Section>

      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("setup.title")}</DialogTitle>
            <DialogDescription>{t("setup.description")}</DialogDescription>
          </DialogHeader>

          {setup ? (
            <div className="space-y-5">
              <div className="flex justify-center rounded-lg border bg-white p-4">
                <QRCode value={setup.otpauthUri} size={184} bordered={false} />
              </div>

              <div className="space-y-2">
                <Label>{t("setup.manualSecret")}</Label>
                <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm break-all">
                  {setup.secret}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="totpSetupCode">{t("setup.codeLabel")}</Label>
                <Input
                  id="totpSetupCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otpCode}
                  onChange={(event) =>
                    setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  className="font-mono tracking-[0.2em]"
                  placeholder="123456"
                />
              </div>

              <Alert>
                <AlertDescription>{t("setup.notice")}</AlertDescription>
              </Alert>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSetupOpen(false)} disabled={saving}>
              {t("setup.cancel")}
            </Button>
            <Button onClick={enableTotp} disabled={saving || !/^\d{6}$/.test(otpCode)}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("setup.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={disableOpen}
        onOpenChange={(open) => {
          if (saving) return;
          setDisableOpen(open);
          if (!open) setDisableOtpCode("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("disable.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("disable.description")}</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="totpDisableCode">{t("disable.codeLabel")}</Label>
            <Input
              id="totpDisableCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={disableOtpCode}
              onChange={(event) =>
                setDisableOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              className="font-mono tracking-[0.2em]"
              placeholder="123456"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{t("disable.cancel")}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={disableTotp}
              disabled={saving || !/^\d{6}$/.test(disableOtpCode)}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("disable.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

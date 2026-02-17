"use client";

import { AlertTriangle, Book, Key, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { Link, useRouter } from "@/i18n/routing";
import { resolveLoginRedirectTarget } from "./redirect-safety";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginPageFallback />}>
      <LoginPageContent />
    </Suspense>
  );
}

type LoginStatus = "idle" | "submitting" | "success" | "error";

interface LoginVersionInfo {
  current: string;
  hasUpdate: boolean;
}

const DEFAULT_SITE_TITLE = "Claude Code Hub";

function formatVersionLabel(version: string): string {
  const trimmed = version.trim();
  if (!trimmed) return "";
  return /^v/i.test(trimmed) ? `v${trimmed.slice(1)}` : `v${trimmed}`;
}

function LoginPageContent() {
  const t = useTranslations("auth");
  const tCustoms = useTranslations("customs");
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "";

  const apiKeyInputRef = useRef<HTMLInputElement>(null);
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<LoginStatus>("idle");
  const [error, setError] = useState("");
  const [showHttpWarning, setShowHttpWarning] = useState(false);
  const [versionInfo, setVersionInfo] = useState<LoginVersionInfo | null>(null);
  const [siteTitle, setSiteTitle] = useState(DEFAULT_SITE_TITLE);

  useEffect(() => {
    if (status === "error" && apiKeyInputRef.current) {
      apiKeyInputRef.current.focus();
    }
  }, [status]);

  // 检测是否为 HTTP（非 localhost）
  useEffect(() => {
    if (typeof window !== "undefined") {
      const isHttp = window.location.protocol === "http:";
      const isLocalhost =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      setShowHttpWarning(isHttp && !isLocalhost);
    }
  }, []);

  useEffect(() => {
    let active = true;

    void fetch("/api/version")
      .then((response) => response.json() as Promise<{ current?: unknown; hasUpdate?: unknown }>)
      .then((data) => {
        if (!active || typeof data.current !== "string") {
          return;
        }

        setVersionInfo({
          current: data.current,
          hasUpdate: Boolean(data.hasUpdate),
        });
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    void fetch("/api/system-settings")
      .then((response) => {
        if (!response.ok) {
          return null;
        }

        return response.json() as Promise<{ siteTitle?: unknown }>;
      })
      .then((data) => {
        if (!active || !data || typeof data.siteTitle !== "string") {
          return;
        }

        const nextSiteTitle = data.siteTitle.trim();
        if (nextSiteTitle) {
          setSiteTitle(nextSiteTitle);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setStatus("submitting");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: apiKey }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || t("errors.loginFailed"));
        setStatus("error");
        return;
      }

      // 登录成功，保持 success 状态（显示遮罩），直到跳转完成
      setStatus("success");
      const redirectTarget = resolveLoginRedirectTarget(data.redirectTo, from);
      router.push(redirectTarget);
      router.refresh();
    } catch {
      setError(t("errors.networkError"));
      setStatus("error");
    }
  };

  const isLoading = status === "submitting" || status === "success";

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-background via-background to-orange-500/5 dark:to-orange-500/10">
      {/* Fullscreen Loading Overlay */}
      {isLoading && (
        <div
          data-testid="loading-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={t("login.loggingIn")}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm transition-all duration-200"
        >
          <Loader2 className="h-12 w-12 animate-spin motion-reduce:animate-none text-primary" />
          <p
            className="mt-4 text-lg font-medium text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {t("login.loggingIn")}
          </p>
        </div>
      )}

      {/* Language Switcher - Fixed Top Right */}
      <div className="fixed top-4 right-4 z-50">
        <LanguageSwitcher size="sm" />
      </div>

      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute right-[5%] top-[-5rem] h-96 w-96 rounded-full bg-orange-500/10 blur-[100px] dark:bg-orange-500/5" />
        <div className="absolute bottom-[-5rem] left-[10%] h-96 w-96 rounded-full bg-orange-400/10 blur-[100px] dark:bg-orange-400/5" />
      </div>

      <div className="mx-auto flex min-h-screen w-full items-center justify-center px-4 py-16">
        <div className="w-full max-w-lg space-y-4">
          <Card className="w-full border-border/50 bg-card/95 shadow-2xl backdrop-blur-xl dark:border-border/30">
            <CardHeader className="space-y-6 flex flex-col items-center text-center pb-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-500/10 text-orange-600 ring-8 ring-orange-500/5 dark:text-orange-400">
                <Key className="h-8 w-8" />
              </div>
              <div className="space-y-2">
                <CardTitle className="text-2xl font-bold tracking-tight">
                  {t("form.title")}
                </CardTitle>
                <CardDescription className="text-base">{t("form.description")}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="px-8 pb-8">
              {showHttpWarning ? (
                <Alert variant="destructive" className="mb-6">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{t("security.cookieWarningTitle")}</AlertTitle>
                  <AlertDescription className="mt-2 space-y-2 text-sm">
                    <p>{t("security.cookieWarningDescription")}</p>
                    <div className="mt-3">
                      <p className="font-medium">{t("security.solutionTitle")}</p>
                      <ol className="ml-4 mt-1 list-decimal space-y-1">
                        <li>{t("security.useHttps")}</li>
                        <li>{t("security.disableSecureCookies")}</li>
                      </ol>
                    </div>
                  </AlertDescription>
                </Alert>
              ) : null}
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="apiKey">API Key</Label>
                    <div className="relative">
                      <Key className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="apiKey"
                        ref={apiKeyInputRef}
                        type="password"
                        placeholder={t("placeholders.apiKeyExample")}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="pl-9"
                        required
                        disabled={isLoading}
                      />
                    </div>
                  </div>

                  {error ? (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  ) : null}
                </div>

                <div className="space-y-2 flex flex-col items-center">
                  <Button
                    type="submit"
                    className="w-full max-w-full"
                    disabled={isLoading || !apiKey.trim()}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t("login.loggingIn")}
                      </>
                    ) : (
                      t("actions.enterConsole")
                    )}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    {t("security.privacyNote")}
                  </p>
                </div>
              </form>

              {/* 文档页入口 */}
              <div className="mt-6 pt-6 border-t flex justify-center">
                <Link
                  href="/usage-doc"
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Book className="h-4 w-4" />
                  {t("actions.viewUsageDoc")}
                </Link>
              </div>
            </CardContent>
          </Card>

          <p
            data-testid="login-site-title-footer"
            className="text-center text-xs text-muted-foreground"
          >
            {siteTitle}
          </p>

          {versionInfo?.current ? (
            <div
              data-testid="login-footer-version"
              className="flex items-center justify-center gap-2 text-xs text-muted-foreground"
            >
              <span className="font-mono">{formatVersionLabel(versionInfo.current)}</span>
              {versionInfo.hasUpdate ? (
                <span className="text-orange-600">{tCustoms("version.updateAvailable")}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LoginPageFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

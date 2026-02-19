"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Book, ExternalLink, Eye, EyeOff, Key, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
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
type LoginType = "admin" | "dashboard_user" | "readonly_user";

interface LoginVersionInfo {
  current: string;
  hasUpdate: boolean;
}

const DEFAULT_SITE_TITLE = "Claude Code Hub";

function parseLoginType(value: unknown): LoginType | null {
  if (value === "admin" || value === "dashboard_user" || value === "readonly_user") {
    return value;
  }

  return null;
}

function getLoginTypeFallbackPath(loginType: LoginType): string {
  return loginType === "readonly_user" ? "/my-usage" : "/dashboard";
}

function formatVersionLabel(version: string): string {
  const trimmed = version.trim();
  if (!trimmed) return "";
  return /^v/i.test(trimmed) ? `v${trimmed.slice(1)}` : `v${trimmed}`;
}

const floatAnimation = {
  y: [0, -20, 0],
  transition: {
    duration: 6,
    repeat: Number.POSITIVE_INFINITY,
    ease: "easeInOut" as const,
  },
};

const floatAnimationSlow = {
  y: [0, -15, 0],
  transition: {
    duration: 8,
    repeat: Number.POSITIVE_INFINITY,
    ease: "easeInOut" as const,
  },
};

const brandPanelVariants = {
  hidden: { opacity: 0, x: -40 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { type: "spring" as const, stiffness: 300, damping: 30 },
  },
};

const stagger = {
  hidden: { opacity: 0, y: 20 },
  visible: (delay: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, delay, ease: "easeOut" as const },
  }),
};

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
  const [showPassword, setShowPassword] = useState(false);
  const [versionInfo, setVersionInfo] = useState<LoginVersionInfo | null>(null);
  const [siteTitle, setSiteTitle] = useState(DEFAULT_SITE_TITLE);

  useEffect(() => {
    if (status === "error" && apiKeyInputRef.current) {
      apiKeyInputRef.current.focus();
    }
  }, [status]);

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

      setStatus("success");
      const loginType = parseLoginType(data.loginType);
      const fallbackPath = loginType ? getLoginTypeFallbackPath(loginType) : from;
      const redirectTarget = resolveLoginRedirectTarget(data.redirectTo, fallbackPath);
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

      {/* Top Right Controls */}
      <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
        <Link
          href="/usage-doc"
          className="flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-3 text-sm text-muted-foreground shadow-xs transition-all hover:border-border hover:bg-accent/60 hover:text-accent-foreground"
        >
          <Book className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("actions.viewUsageDoc")}</span>
          <span className="sm:hidden">
            <ExternalLink className="h-3.5 w-3.5" />
          </span>
        </Link>
        <ThemeSwitcher size="sm" />
        <LanguageSwitcher size="sm" />
      </div>

      {/* Background Orbs */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <motion.div
          animate={floatAnimation}
          className="absolute right-[5%] top-[-5rem] h-96 w-96 rounded-full bg-orange-500/10 blur-[100px] dark:bg-orange-500/5"
        />
        <motion.div
          animate={floatAnimationSlow}
          className="absolute bottom-[-5rem] left-[10%] h-96 w-96 rounded-full bg-orange-400/10 blur-[100px] dark:bg-orange-400/5"
        />
      </div>

      {/* Main Layout */}
      <div className="flex min-h-screen">
        {/* Brand Panel - Desktop Only */}
        <motion.aside
          data-testid="login-brand-panel"
          variants={brandPanelVariants}
          initial="hidden"
          animate="visible"
          className="relative hidden w-[45%] items-center justify-center overflow-hidden lg:flex"
        >
          {/* Brand Panel Gradient Background */}
          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 via-orange-400/5 to-transparent dark:from-orange-500/15 dark:via-orange-400/10" />

          {/* Brand Panel Animated Orb */}
          <motion.div
            animate={floatAnimationSlow}
            className="absolute top-1/4 left-1/3 h-64 w-64 rounded-full bg-orange-500/8 blur-[80px] dark:bg-orange-500/5"
          />

          <div className="relative z-10 flex flex-col items-center gap-6 px-12 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-orange-500/15 text-orange-600 ring-8 ring-orange-500/5 dark:text-orange-400">
              <Key className="h-10 w-10" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{siteTitle}</h1>
            <p className="max-w-xs text-base text-muted-foreground">{t("brand.tagline")}</p>
            <div className="mt-4 h-16 w-px bg-gradient-to-b from-transparent via-border to-transparent" />
          </div>
        </motion.aside>

        {/* Form Panel */}
        <div className="flex w-full flex-col items-center justify-center px-4 py-16 lg:w-[55%]">
          {/* Mobile Brand Header */}
          <div className="mb-8 flex flex-col items-center gap-3 text-center lg:hidden">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600 ring-4 ring-orange-500/5 dark:text-orange-400">
              <Key className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-bold tracking-tight text-foreground">{siteTitle}</h1>
              <p className="text-sm text-muted-foreground">{t("brand.tagline")}</p>
            </div>
          </div>

          <div className="w-full max-w-lg space-y-4">
            <motion.div custom={0.1} variants={stagger} initial="hidden" animate="visible">
              <Card className="w-full border-border/50 bg-card/95 shadow-2xl backdrop-blur-xl dark:border-border/30">
                <CardHeader className="space-y-6 flex flex-col items-center text-center pt-8 pb-8">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-500/10 text-orange-600 ring-8 ring-orange-500/5 dark:text-orange-400 lg:hidden">
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
                    <motion.div
                      custom={0.15}
                      variants={stagger}
                      initial="hidden"
                      animate="visible"
                      className="space-y-3"
                    >
                      <div className="space-y-2">
                        <Label htmlFor="apiKey">{t("form.apiKeyLabel")}</Label>
                        <div className="relative">
                          <Key className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            id="apiKey"
                            ref={apiKeyInputRef}
                            type={showPassword ? "text" : "password"}
                            placeholder={t("placeholders.apiKeyExample")}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            className="pl-9 pr-10"
                            required
                            disabled={isLoading}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((prev) => !prev)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            aria-label={
                              showPassword ? t("form.hidePassword") : t("form.showPassword")
                            }
                            tabIndex={-1}
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      {error ? (
                        <Alert variant="destructive">
                          <AlertDescription>{error}</AlertDescription>
                        </Alert>
                      ) : null}
                    </motion.div>

                    <motion.div
                      custom={0.2}
                      variants={stagger}
                      initial="hidden"
                      animate="visible"
                      className="space-y-2 flex flex-col items-center"
                    >
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
                    </motion.div>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Page Footer */}
      <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center gap-1">
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
  );
}

function LoginPageFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

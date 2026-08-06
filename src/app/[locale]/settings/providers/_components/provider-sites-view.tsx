"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Check,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  GripVertical,
  Loader2,
  Minus,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import {
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getProviderGroups,
  updateProviderGroup,
} from "@/lib/api-client/v1/actions/provider-groups";
import type { ProviderSiteListItem } from "@/lib/api-client/v1/actions/provider-sites";
import {
  createProviderSite,
  deleteProviderSite,
  getProviderSites,
  reorderProviderSites,
  syncAllProviderSiteRates,
  syncProviderSiteRates,
  updateProviderSite,
} from "@/lib/api-client/v1/actions/provider-sites";
import { testProviderById } from "@/lib/api-client/v1/actions/providers";
import { fetchSystemSettings, saveSystemSettings } from "@/lib/api-client/v1/actions/system-config";
import {
  DEFAULT_HEALTH_TEST_SLO_THRESHOLDS,
  type HealthTestSloThresholds,
} from "@/lib/provider-health-test/slo-thresholds";
import {
  type ProviderSiteGroupHealthState as GroupHealthState,
  resolveProviderSiteGroupHealthState,
} from "@/lib/provider-sites/group-health";
import { cn } from "@/lib/utils";
import { sumCosts } from "@/lib/utils/currency";
import type { ProviderDisplay } from "@/types/provider";
import { invalidateProviderQueries } from "./invalidate-provider-queries";
import { getProviderHealthTestStatus, ProviderHealthTestCard } from "./provider-health-test-card";

interface ProviderSitesViewProps {
  providers: ProviderDisplay[];
  isAdmin: boolean;
  onRequestEditProvider?: (providerId: number) => void;
}

type SiteFormState = {
  name: string;
  siteUrl: string;
  siteType: "sub2api" | "newapi" | "custom";
  notes: string;
  username: string;
  password: string;
  turnstileEnabled: boolean;
  captchaProvider: "none" | "global" | "yescaptcha" | "capsolver" | "2captcha" | "anticaptcha";
};

const INITIAL_SITE_FORM: SiteFormState = {
  name: "",
  siteUrl: "https://",
  siteType: "sub2api",
  notes: "",
  username: "",
  password: "",
  turnstileEnabled: false,
  captchaProvider: "global",
};

function ratioTone(ratio: number): string {
  if (ratio <= 0) return "bg-muted text-muted-foreground border-border";
  if (ratio < 0.05)
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  if (ratio < 0.15) return "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30";
  if (ratio < 0.5) return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
  if (ratio < 1)
    return "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30";
  return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30";
}

function formatRatio(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  if (Number.isInteger(value)) return `${value}x`;
  const fixed = value < 0.1 ? value.toFixed(4) : value.toFixed(3);
  return `${fixed.replace(/\.?0+$/, "")}x`;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function normalizeSiteGroupKey(value: string | null | undefined): string {
  return (value || "").toLowerCase().replace(/[\s\-_/\u3010\u3011[\]()（）]+/g, "");
}

function tagBadgeClass(tag: string | null | undefined): string {
  switch ((tag || "").toLowerCase()) {
    case "claude":
      return "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30";
    case "codex":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30";
    case "grok":
      return "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30";
    case "image":
      return "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

type GlobalCaptchaState = {
  provider: "none" | "yescaptcha" | "capsolver" | "2captcha" | "anticaptcha";
  apiKey: string;
  endpoint: string;
  hasKey: boolean;
};

function formatCompletionRatio(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return formatRatio(value);
}

function SortableSiteShell({
  id,
  disabled,
  children,
}: {
  id: number;
  disabled?: boolean;
  children: (args: {
    setNodeRef: (node: HTMLElement | null) => void;
    style: CSSProperties;
    attributes: Record<string, unknown>;
    listeners: Record<string, unknown> | undefined;
    isDragging: boolean;
  }) => ReactElement;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
  };
  return (
    <>
      {children({
        setNodeRef,
        style,
        attributes: attributes as unknown as Record<string, unknown>,
        listeners: listeners as unknown as Record<string, unknown> | undefined,
        isDragging,
      })}
    </>
  );
}

// Preserve rectSortingStrategy's grid reordering, but never scale variable-height cards.
const noScaleRectSortingStrategy = (args: Parameters<typeof rectSortingStrategy>[0]) => {
  const transform = rectSortingStrategy(args);
  return transform ? { ...transform, scaleX: 1, scaleY: 1 } : null;
};

/** Match providers under a website group rate row. */
function matchSiteGroupMembers(
  siteProviders: ProviderDisplay[],
  rate: { groupName: string; dispatchGroupTag?: string | null }
): ProviderDisplay[] {
  const groupName = rate.groupName || "";
  const tag = (rate.dispatchGroupTag || "").trim();
  const normGroup = normalizeSiteGroupKey(groupName);

  const exact = siteProviders.filter((p) => {
    const sgn = p.siteGroupName || "";
    if (!sgn) return false;
    if (sgn === groupName) return true;
    return normalizeSiteGroupKey(sgn) === normGroup;
  });
  if (exact.length > 0) return exact;

  return siteProviders.filter((p) => {
    const sgn = p.siteGroupName || "";
    if (sgn) {
      const ns = normalizeSiteGroupKey(sgn);
      if (normGroup && (ns.includes(normGroup) || normGroup.includes(ns))) return true;
      if (groupName && p.name.includes(groupName)) return true;
      return false;
    }
    if (groupName && p.name.includes(groupName)) return true;
    if (!tag) return false;
    const tags = (p.groupTag || "")
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return tags.includes(tag);
  });
}

function groupHealthLabel(state: GroupHealthState, t: (key: string) => string): string {
  switch (state) {
    case "ok":
      return t("healthTestOk");
    case "failed":
      return t("healthTestFailed");
    case "disabled":
      return t("healthTestDisabled");
    default:
      return t("healthTestPending");
  }
}

function groupHealthClass(state: GroupHealthState): string {
  switch (state) {
    case "ok":
      return "border-emerald-200/80 bg-emerald-50/70 hover:border-emerald-300 dark:border-emerald-900/70 dark:bg-emerald-950/25";
    case "failed":
      return "border-rose-200/80 bg-rose-50/70 hover:border-rose-300 dark:border-rose-900/70 dark:bg-rose-950/25";
    case "disabled":
      return "border-border/70 bg-muted/35 hover:border-border";
    default:
      return "border-amber-200/80 bg-amber-50/70 hover:border-amber-300 dark:border-amber-900/70 dark:bg-amber-950/25";
  }
}

function groupHealthIcon(state: GroupHealthState) {
  const className = "h-4 w-4";
  switch (state) {
    case "ok":
      return <Check className={className} strokeWidth={2.5} />;
    case "failed":
      return <X className={className} strokeWidth={2.5} />;
    case "disabled":
      return <Minus className={className} strokeWidth={2.5} />;
    default:
      return <CircleHelp className={className} strokeWidth={2.25} />;
  }
}

function groupHealthIconClass(state: GroupHealthState): string {
  switch (state) {
    case "ok":
      return "border-emerald-300/80 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300";
    case "failed":
      return "border-rose-300/80 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300";
    case "disabled":
      return "border-border bg-muted text-muted-foreground";
    default:
      return "border-amber-300/80 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300";
  }
}

export function ProviderSitesView({
  providers,
  isAdmin,
  onRequestEditProvider,
}: ProviderSitesViewProps) {
  const t = useTranslations("settings.providers.providerSites");
  const tHealth = useTranslations("settings.providers.list");
  const queryClient = useQueryClient();
  const [sites, setSites] = useState<ProviderSiteListItem[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<{ siteId: number; rateId: number } | null>(
    null
  );
  const [dispatchHealthModels, setDispatchHealthModels] = useState<Record<string, string | null>>(
    {}
  );
  const [isLoading, startLoad] = useTransition();
  const [isSaving, startSave] = useTransition();
  const [siteDialogOpen, setSiteDialogOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<ProviderSiteListItem | null>(null);
  const [deletingSite, setDeletingSite] = useState<ProviderSiteListItem | null>(null);
  const [siteForm, setSiteForm] = useState<SiteFormState>(INITIAL_SITE_FORM);
  const [healthWindowSize, setHealthWindowSize] = useState(10);
  const [healthSloThresholds, setHealthSloThresholds] = useState<HealthTestSloThresholds>(
    DEFAULT_HEALTH_TEST_SLO_THRESHOLDS
  );
  const [globalCaptcha, setGlobalCaptcha] = useState<GlobalCaptchaState>({
    provider: "none",
    apiKey: "",
    endpoint: "",
    hasKey: false,
  });
  const [isReordering, startReorder] = useTransition();
  const [activeSiteId, setActiveSiteId] = useState<number | null>(null);
  const [activeSiteSize, setActiveSiteSize] = useState<{ width: number } | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [manualTestingProviderIds, setManualTestingProviderIds] = useState<Record<number, boolean>>(
    {}
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const loadSites = useCallback(async () => {
    const result = await getProviderSites();
    if (result.ok) {
      setSites(result.data);
    } else {
      toast.error(result.error);
    }
    try {
      const groupsRes = await getProviderGroups();
      if (groupsRes.ok && Array.isArray(groupsRes.data)) {
        const map: Record<string, string | null> = {};
        for (const g of groupsRes.data) {
          map[g.name] = g.healthTestModel ?? null;
        }
        setDispatchHealthModels(map);
      }
    } catch {
      // optional overlay
    }
    try {
      const settingsRes = await fetchSystemSettings();
      if (settingsRes.ok && settingsRes.data) {
        const data = settingsRes.data as {
          healthTestWindowSize?: number;
          healthTestMinOnlineRatePercent?: number;
          healthTestMaxAvgLatencySeconds?: number;
          siteCaptchaProvider?: string;
          hasSiteCaptchaApiKey?: boolean;
          siteCaptchaEndpoint?: string | null;
        };
        const win = Number(data.healthTestWindowSize);
        if (Number.isFinite(win) && win > 0) {
          setHealthWindowSize(Math.min(50, Math.max(1, Math.trunc(win))));
        }
        const minOnlineRatePercent = Number(data.healthTestMinOnlineRatePercent);
        const maxAvgFirstByteSeconds = Number(data.healthTestMaxAvgLatencySeconds);
        setHealthSloThresholds((current) => ({
          minOnlineRate:
            Number.isFinite(minOnlineRatePercent) && minOnlineRatePercent >= 0
              ? Math.min(1, minOnlineRatePercent / 100)
              : current.minOnlineRate,
          maxAvgFirstByteMs:
            Number.isFinite(maxAvgFirstByteSeconds) && maxAvgFirstByteSeconds >= 0
              ? maxAvgFirstByteSeconds * 1000
              : current.maxAvgFirstByteMs,
          minSampleCount:
            Number.isFinite(win) && win > 0
              ? Math.min(50, Math.max(1, Math.trunc(win)))
              : current.minSampleCount,
        }));
        const provider = String(data.siteCaptchaProvider || "none").toLowerCase();
        setGlobalCaptcha((prev) => ({
          ...prev,
          provider: (["yescaptcha", "capsolver", "2captcha", "anticaptcha"].includes(provider)
            ? provider
            : "none") as GlobalCaptchaState["provider"],
          hasKey: Boolean(data.hasSiteCaptchaApiKey),
          endpoint: data.siteCaptchaEndpoint ?? "",
          apiKey: "",
        }));
      }
    } catch {
      // optional
    }
  }, []);

  const fetchSites = useCallback(() => {
    startLoad(() => {
      void loadSites();
    });
  }, [loadSites]);

  const refreshProviderData = useCallback(async () => {
    await loadSites();
    await invalidateProviderQueries(queryClient);
  }, [loadSites, queryClient]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  const providersBySite = useMemo(() => {
    const map = new Map<number, ProviderDisplay[]>();
    for (const provider of providers) {
      const siteId = provider.siteId;
      if (siteId == null) continue;
      const list = map.get(siteId) ?? [];
      list.push(provider);
      map.set(siteId, list);
    }
    return map;
  }, [providers]);

  const unassignedProviders = useMemo(() => providers.filter((p) => p.siteId == null), [providers]);

  const selectedGroupData = useMemo(() => {
    if (!selectedGroup) return null;
    const site = sites.find((item) => item.id === selectedGroup.siteId);
    const rate = site?.groupRates.find((item) => item.id === selectedGroup.rateId);
    if (!site || !rate) return null;
    return {
      site,
      rate,
      members: matchSiteGroupMembers(providersBySite.get(site.id) ?? [], rate),
    };
  }, [providersBySite, selectedGroup, sites]);
  const selectedGroupHealthState = selectedGroupData
    ? resolveProviderSiteGroupHealthState(
        selectedGroupData.members,
        healthSloThresholds,
        healthWindowSize
      )
    : null;
  const selectedGroupTag = selectedGroupData?.rate.dispatchGroupTag?.trim() ?? "";
  const selectedGroupHealthModel = selectedGroupTag
    ? (dispatchHealthModels[selectedGroupTag] ?? null)
    : null;
  const activeSite = useMemo(
    () => (activeSiteId == null ? null : (sites.find((site) => site.id === activeSiteId) ?? null)),
    [activeSiteId, sites]
  );
  const siteTodayCostValues = useMemo(
    () => sites.flatMap((site) => (site.todayCost == null ? [] : [site.todayCost])),
    [sites]
  );
  const siteTodayCost = useMemo(() => sumCosts(siteTodayCostValues), [siteTodayCostValues]);
  const siteTodayCostText = useMemo(() => {
    if (siteTodayCostValues.length === 0) return "—";
    return siteTodayCost.toFixed(4);
  }, [siteTodayCost, siteTodayCostValues.length]);

  const openCreateSite = useCallback(() => {
    setEditingSite(null);
    setSiteForm(INITIAL_SITE_FORM);
    setSiteDialogOpen(true);
  }, []);

  const openEditSite = useCallback((site: ProviderSiteListItem) => {
    setEditingSite(site);
    setSiteForm({
      name: site.name,
      siteUrl: site.siteUrl,
      siteType: (["sub2api", "newapi", "custom"].includes(site.siteType)
        ? site.siteType
        : "custom") as SiteFormState["siteType"],
      notes: site.notes ?? "",
      username: site.username ?? "",
      password: "",
      turnstileEnabled: Boolean(site.turnstileEnabled),
      captchaProvider: ([
        "none",
        "global",
        "yescaptcha",
        "capsolver",
        "2captcha",
        "anticaptcha",
      ].includes(site.captchaProvider || "")
        ? site.captchaProvider
        : "global") as SiteFormState["captchaProvider"],
    });
    setSiteDialogOpen(true);
  }, []);

  const handleSaveSite = useCallback(() => {
    const name = siteForm.name.trim();
    const siteUrl = siteForm.siteUrl.trim();
    if (!name) {
      toast.error(t("nameRequired"));
      return;
    }
    startSave(async () => {
      const credentialPayload = {
        username: siteForm.username.trim() || null,
        turnstileEnabled: siteForm.turnstileEnabled,
        captchaProvider: siteForm.captchaProvider,
        // Clear per-site captcha secrets when using global/none.
        captchaApiKey: null,
        captchaEndpoint: null,
        ...(siteForm.password.trim() ? { password: siteForm.password.trim() } : {}),
      };
      const result = editingSite
        ? await updateProviderSite(editingSite.id, {
          name,
          siteUrl,
          siteType: siteForm.siteType,
          notes: siteForm.notes.trim() || null,
          ...credentialPayload,
        })
        : await createProviderSite({
            name,
            siteUrl,
            siteType: siteForm.siteType,
            notes: siteForm.notes.trim() || null,
            ...credentialPayload,
          });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(editingSite ? t("updateSuccess") : t("createSuccess"));
      setSiteDialogOpen(false);
      await refreshProviderData();
    });
  }, [editingSite, refreshProviderData, siteForm, t]);

  const handleToggleEnabled = useCallback(
    (site: ProviderSiteListItem) => {
      startSave(async () => {
        const result = await updateProviderSite(site.id, { isEnabled: !site.isEnabled });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(t("updateSuccess"));
        await refreshProviderData();
      });
    },
    [refreshProviderData, t]
  );

  const handleDeleteSite = useCallback(() => {
    if (!deletingSite) return;
    const site = deletingSite;
    startSave(async () => {
      const result = await deleteProviderSite(site.id);
      if (!result.ok) {
        toast.error(result.error || t("deleteFailed"));
        return;
      }
      toast.success(t("deleteSuccess"));
      setDeletingSite(null);
      setSiteDialogOpen(false);
      await refreshProviderData();
    });
  }, [deletingSite, refreshProviderData, t]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveSiteId(null);
      setActiveSiteSize(null);
      if (!isAdmin) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = sites.findIndex((s) => s.id === Number(active.id));
      const newIndex = sites.findIndex((s) => s.id === Number(over.id));
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      const reordered = arrayMove(sites, oldIndex, newIndex);
      setSites(reordered);
      startReorder(async () => {
        const result = await reorderProviderSites(reordered.map((s) => s.id));
        if (result.ok) {
          setSites(result.data);
          toast.success(t("reorderSuccess"));
        } else {
          toast.error(result.error ?? t("reorderFailed"));
          fetchSites();
        }
      });
    },
    [fetchSites, isAdmin, sites, t]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveSiteId(Number(event.active.id));
    const rect = event.active.rect.current.initial;
    setActiveSiteSize(rect ? { width: rect.width } : null);
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveSiteId(null);
    setActiveSiteSize(null);
  }, []);

  const handleSaveGlobalCaptcha = useCallback(() => {
    startSave(async () => {
      const payload: {
        siteCaptchaProvider: string;
        siteCaptchaEndpoint: string | null;
        siteCaptchaApiKey?: string | null;
      } = {
        siteCaptchaProvider: globalCaptcha.provider,
        siteCaptchaEndpoint: globalCaptcha.endpoint.trim() || null,
      };
      if (globalCaptcha.apiKey.trim()) {
        payload.siteCaptchaApiKey = globalCaptcha.apiKey.trim();
      }
      const result = await saveSystemSettings(payload);
      if (!result.ok) {
        toast.error(result.error || t("globalCaptchaSaveFailed"));
        return;
      }
      toast.success(t("globalCaptchaSaved"));
      setGlobalCaptcha((prev) => ({
        ...prev,
        apiKey: "",
        hasKey: Boolean(
          (result.data as { hasSiteCaptchaApiKey?: boolean } | undefined)?.hasSiteCaptchaApiKey ??
            (prev.hasKey || Boolean(globalCaptcha.apiKey.trim()))
        ),
        endpoint:
          ((result.data as { siteCaptchaEndpoint?: string | null } | undefined)
            ?.siteCaptchaEndpoint ??
            prev.endpoint) ||
          "",
      }));
    });
  }, [globalCaptcha, t]);

  const handleSyncSite = useCallback(
    (site: ProviderSiteListItem) => {
      startSave(async () => {
        const result = await syncProviderSiteRates(site.id);
        if (!result.ok) {
          toast.error(result.error || t("syncFailed"));
          fetchSites();
          return;
        }
        const ks = result.data.keysSynced;
        toast.success(
          ks
            ? t("syncSuccessWithKeys", {
                count: result.data.groupsUpserted,
                created: ks.created,
                deleted: ks.deleted,
              })
            : t("syncSuccess", { count: result.data.groupsUpserted })
        );
        await refreshProviderData();
      });
    },
    [fetchSites, refreshProviderData, t]
  );

  const handleSyncAll = useCallback(() => {
    startSave(async () => {
      const result = await syncAllProviderSiteRates();
      if (!result.ok) {
        toast.error(result.error || t("syncFailed"));
        fetchSites();
        return;
      }
      const items = result.data;
      const ok = items.filter((i) => i.ok).length;
      const created = items.reduce((acc, i) => acc + (i.keysSynced?.created ?? 0), 0);
      const deleted = items.reduce((acc, i) => acc + (i.keysSynced?.deleted ?? 0), 0);
      toast.success(
        created + deleted > 0
          ? t("syncAllSuccessWithKeys", { ok, total: items.length, created, deleted })
          : t("syncAllSuccess", { ok, total: items.length })
      );
      await refreshProviderData();
    });
  }, [fetchSites, refreshProviderData, t]);

  const handleManualHealthTest = useCallback(
    async (provider: ProviderDisplay) => {
      if (manualTestingProviderIds[provider.id]) return;
      setManualTestingProviderIds((prev) => ({ ...prev, [provider.id]: true }));
      try {
        const model = selectedGroupHealthModel?.trim();
        const result = await testProviderById(provider.id, model ? { model } : undefined);
        if (!result.ok) {
          toast.error(t("groupHealthManualTestFailed"));
          return;
        }
        toast.success(t("groupHealthManualTestSuccess"));
        await invalidateProviderQueries(queryClient);
      } catch {
        toast.error(t("groupHealthManualTestFailed"));
      } finally {
        setManualTestingProviderIds((prev) => {
          const next = { ...prev };
          delete next[provider.id];
          return next;
        });
      }
    },
    [manualTestingProviderIds, queryClient, selectedGroupHealthModel, t]
  );

  const saveDispatchHealthModel = useCallback(
    async (dispatchTag: string, model: string) => {
      const tag = dispatchTag.trim();
      if (!tag || tag === "other") {
        toast.error(t("healthModelTagRequired"));
        return;
      }
      try {
        const groupsRes = await getProviderGroups();
        if (!groupsRes.ok || !Array.isArray(groupsRes.data)) {
          toast.error(groupsRes.ok === false ? groupsRes.error : t("healthModelSaveFailed"));
          return;
        }
        const group = groupsRes.data.find((g) => g.name === tag);
        if (!group) {
          toast.error(t("healthModelGroupMissing", { tag }));
          return;
        }
        const res = await updateProviderGroup(group.id, {
          healthTestModel: model.trim() || null,
        });
        if (!res.ok) {
          toast.error(res.error || t("healthModelSaveFailed"));
          return;
        }
        setDispatchHealthModels((prev) => ({ ...prev, [tag]: model.trim() || null }));
        toast.success(t("healthModelSaved"));
        await invalidateProviderQueries(queryClient);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("healthModelSaveFailed"));
      }
    },
    [queryClient, t]
  );

  const renderSiteCard = (
    site: ProviderSiteListItem,
    isDragging: boolean,
    dragAttributes?: Record<string, unknown>,
    dragListeners?: Record<string, unknown>
  ) => {
    const siteProviders = providersBySite.get(site.id) ?? [];
    const rates = [...site.groupRates].sort((a, b) => a.ratio - b.ratio);
    const minRatio = rates[0]?.ratio;
    const maxRatio = rates[rates.length - 1]?.ratio;

    return (
      <Card
        className={cn(
          "group/site flex flex-col gap-0 overflow-hidden border-border/70 bg-card/95 p-0 transition-[box-shadow,opacity,ring-color] duration-200",
          "shadow-sm ring-1 ring-border/70",
          isDragging &&
            "pointer-events-none border-dashed border-primary/40 bg-primary/[0.04] opacity-35 shadow-none ring-2 ring-primary/15"
        )}
      >
        <CardHeader className="space-y-2 border-b bg-gradient-to-br from-muted/45 via-card to-card p-3 sm:p-3.5">
          <div className="flex items-start gap-3">
            {isAdmin ? (
              <button
                type="button"
                className="mt-0.5 flex h-7 w-7 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-md border border-transparent text-muted-foreground/75 transition-colors hover:bg-background/80 hover:text-foreground focus-visible:border-primary/40 focus-visible:bg-background active:cursor-grabbing"
                onClick={(e) => e.stopPropagation()}
                aria-label={t("dragHint")}
                {...(dragAttributes ?? {})}
                {...(dragListeners ?? {})}
              >
                <GripVertical className="h-4 w-4" />
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-[15px] font-semibold tracking-tight">{site.name}</span>
                <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
                  {site.siteType}
                </Badge>
                <Badge
                  variant={site.isEnabled ? "default" : "secondary"}
                  className={cn(
                    "h-5 px-1.5 text-[10px] font-medium",
                    site.isEnabled &&
                      "border-transparent bg-amber-500 text-white hover:bg-amber-500"
                  )}
                >
                  {site.isEnabled ? t("enabled") : t("disabled")}
                </Badge>
                {minRatio != null && maxRatio != null ? (
                  <span className="inline-flex items-center gap-1">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 font-mono text-[11px]",
                        ratioTone(minRatio)
                      )}
                    >
                      {formatRatio(minRatio)}
                    </span>
                    {minRatio !== maxRatio ? (
                      <>
                        <span className="text-[11px] text-muted-foreground">~</span>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 font-mono text-[11px]",
                            ratioTone(maxRatio)
                          )}
                        >
                          {formatRatio(maxRatio)}
                        </span>
                      </>
                    ) : null}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <span className="truncate font-medium text-foreground/75">
                  {hostnameOf(site.siteUrl)}
                </span>
                <a
                  href={site.siteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                  aria-label={site.siteUrl}
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div className="min-w-0 rounded-md border border-border/50 bg-background/65 px-2 py-1.5">
              <p className="truncate text-[11px] text-muted-foreground">
                {t("rateCount", { count: site.groupRates.length })}
              </p>
            </div>
            <div className="min-w-0 rounded-lg border border-border/50 bg-background/65 px-2.5 py-2">
              <p className="truncate text-[11px] text-muted-foreground">
                {t("providerCount", {
                  enabled: site.enabledProviderCount,
                  total: site.providerCount,
                })}
              </p>
            </div>
            {site.lastBalance != null ? (
              <div className="min-w-0 rounded-md border border-border/50 bg-background/65 px-2 py-1.5">
                <p className="truncate text-[11px] text-muted-foreground">
                  {t("upstreamBalance")} {" "}
                  <span className="font-mono text-foreground/80">
                    {Number(site.lastBalance).toFixed(4)}
                  </span>
                </p>
              </div>
            ) : null}
            {site.todayCost != null ? (
              <div className="min-w-0 rounded-md border border-border/50 bg-background/65 px-2 py-1.5">
                <p className="truncate text-[11px] text-muted-foreground">
                  {t("todayCost")} {" "}
                  <span className="font-mono text-foreground/80">
                    {Number(site.todayCost).toFixed(4)}
                  </span>
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {site.lastRateSyncedAt ? (
              <span className="truncate">
                {t("lastSync")} {new Date(site.lastRateSyncedAt).toLocaleString()}
              </span>
            ) : !site.hasPassword ? (
              <span className="truncate text-amber-600 dark:text-amber-400">
                {t("noCredentials")}
              </span>
            ) : null}
            {site.lastSyncError ? (
              <span className="truncate text-destructive" title={site.lastSyncError}>
                {t("syncError")}
              </span>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-2.5 bg-muted/10 p-3 sm:p-3.5">
          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-1">
              <Button
                size="sm"
                variant="secondary"
                className="h-7 px-2.5 text-xs"
                onClick={() => handleSyncSite(site)}
                disabled={isSaving}
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                {t("syncRates")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs"
                onClick={() => openEditSite(site)}
              >
                {t("editSite")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs"
                onClick={() => handleToggleEnabled(site)}
              >
                {site.isEnabled ? t("disableSite") : t("enableSite")}
              </Button>
            </div>
          ) : null}

          {rates.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-background/60 px-4 py-8 text-center text-sm text-muted-foreground">
              {t("noRates")}
            </div>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {rates.map((rate) => {
                const tag = rate.dispatchGroupTag || "";
                const members = matchSiteGroupMembers(siteProviders, rate);
                const healthState = resolveProviderSiteGroupHealthState(
                  members,
                  healthSloThresholds,
                  healthWindowSize
                );
                const healthLabel = groupHealthLabel(healthState, tHealth);
                return (
                  <button
                    key={rate.id}
                    type="button"
                    className={cn(
                      "group/rate flex min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border px-2 py-2 text-left transition-colors hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      groupHealthClass(healthState)
                    )}
                    onClick={() => setSelectedGroup({ siteId: site.id, rateId: rate.id })}
                    aria-label={`${rate.groupName} · ${healthLabel}`}
                  >
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                        groupHealthIconClass(healthState)
                      )}
                      aria-hidden="true"
                    >
                      {groupHealthIcon(healthState)}
                    </span>
                    <span className="min-w-0 flex-1 overflow-hidden">
                      <span className="block truncate text-xs font-medium leading-4">
                        {rate.groupName}
                      </span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden">
                        <span
                          className={cn(
                            "inline-flex shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[10px]",
                            ratioTone(rate.ratio)
                          )}
                        >
                          {formatRatio(rate.ratio)}
                        </span>
                        {tag ? (
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate rounded-full border px-1.5 py-0.5 text-[10px]",
                              tagBadgeClass(tag)
                            )}
                          >
                            {tag}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover/rate:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (isLoading && sites.length === 0) {
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border bg-card/80 p-3.5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 className="h-3.5 w-3.5" />
            </span>
            {t("heroTitle")}
          </div>
          <p className="text-xs text-muted-foreground max-w-2xl pl-9">{t("heroDesc")}</p>
        </div>
        {isAdmin ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={handleSyncAll} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t("syncAllRates")}
            </Button>
            <Button size="sm" onClick={openCreateSite}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {t("addSite")}
            </Button>
          </div>
        ) : null}
      </div>

      <Card className="border-border/70">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium">{t("todayCostTotalTitle")}</CardTitle>
          <CardDescription className="text-xs">{t("todayCostTotalHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="font-mono text-2xl font-semibold tabular-nums">{siteTodayCostText}</div>
        </CardContent>
      </Card>

      {isAdmin ? (
        <Card className="border-border/70">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium">{t("globalCaptchaTitle")}</CardTitle>
            <CardDescription className="text-xs">{t("globalCaptchaDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 pb-4 sm:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("fieldCaptchaProvider")}
              </label>
              <Select
                value={globalCaptcha.provider}
                onValueChange={(value) =>
                  setGlobalCaptcha((prev) => ({
                    ...prev,
                    provider: value as GlobalCaptchaState["provider"],
                  }))
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("captchaNone")}</SelectItem>
                  <SelectItem value="yescaptcha">YesCaptcha</SelectItem>
                  <SelectItem value="capsolver">CapSolver</SelectItem>
                  <SelectItem value="2captcha">2Captcha</SelectItem>
                  <SelectItem value="anticaptcha">AntiCaptcha</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("fieldCaptchaApiKey")}
              </label>
              <Input
                type="password"
                className="h-9"
                value={globalCaptcha.apiKey}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setGlobalCaptcha((prev) => ({ ...prev, apiKey: e.target.value }))
                }
                placeholder={globalCaptcha.hasKey ? t("fieldPasswordPlaceholder") : "API Key"}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("fieldCaptchaEndpoint")}
              </label>
              <Input
                className="h-9"
                value={globalCaptcha.endpoint}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setGlobalCaptcha((prev) => ({ ...prev, endpoint: e.target.value }))
                }
                placeholder="https://api.capsolver.com"
              />
            </div>
            <div className="flex items-end">
              <Button size="sm" onClick={handleSaveGlobalCaptcha} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                {t("save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {sites.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground/70" />
            <div>
              <p className="font-medium">{t("emptyTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("emptyDesc")}</p>
            </div>
            {isAdmin ? (
              <Button onClick={openCreateSite} variant="secondary">
                <Plus className="mr-1.5 h-4 w-4" />
                {t("addSite")}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragStart={handleDragStart}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sites.map((s) => s.id)}
            strategy={noScaleRectSortingStrategy}
          >
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {sites.map((site) => (
                <SortableSiteShell key={site.id} id={site.id} disabled={!isAdmin || isReordering}>
                  {({ setNodeRef, style, attributes, listeners, isDragging }) => (
                    <div
                      ref={setNodeRef}
                      style={style}
                      className="relative min-w-0 will-change-transform"
                    >
                      {renderSiteCard(site, isDragging, attributes, listeners)}
                    </div>
                  )}
                </SortableSiteShell>
              ))}
            </div>
          </SortableContext>
          {isMounted
            ? createPortal(
                <DragOverlay adjustScale={false} dropAnimation={null}>
                  {activeSite ? (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none"
                      style={activeSiteSize ? { width: activeSiteSize.width } : undefined}
                    >
                      {renderSiteCard(activeSite, false)}
                    </div>
                  ) : null}
                </DragOverlay>,
                document.body
              )
            : null}
        </DndContext>
      )}

      {unassignedProviders.length > 0 ? (
        <Card className="border-dashed">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium">{t("unassignedTitle")}</CardTitle>
            <CardDescription>
              {t("unassignedDesc", { count: unassignedProviders.length })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 pb-4">
            {unassignedProviders.slice(0, 24).map((provider) => (
              <Badge key={provider.id} variant="outline" className="font-normal">
                {provider.name}
              </Badge>
            ))}
            {unassignedProviders.length > 24 ? (
              <span className="text-xs text-muted-foreground">
                +{unassignedProviders.length - 24}
              </span>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {selectedGroupData && selectedGroupHealthState ? (
        <Dialog open onOpenChange={(open) => !open && setSelectedGroup(null)}>
          <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto p-0">
            <DialogHeader className="border-b bg-gradient-to-br from-muted/45 via-card to-card px-6 py-5">
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border",
                    groupHealthIconClass(selectedGroupHealthState)
                  )}
                  aria-hidden="true"
                >
                  {groupHealthIcon(selectedGroupHealthState)}
                </div>
                <div className="min-w-0 flex-1">
                  <DialogTitle className="truncate pr-6 text-base">
                    {selectedGroupData.rate.groupName}
                  </DialogTitle>
                  <DialogDescription className="mt-1">
                    {selectedGroupData.site.name} ·{" "}
                    {t("groupHealthTitle", {
                      group: selectedGroupData.rate.groupName,
                      count: selectedGroupData.members.length,
                    })}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-border/50 py-2.5">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/75">
                    {t("fieldRatio")}
                  </p>
                  <span
                    className={cn(
                      "inline-flex min-w-14 items-center justify-center rounded-md border px-2 py-1 font-mono text-sm font-semibold",
                      ratioTone(selectedGroupData.rate.ratio)
                    )}
                  >
                    {formatRatio(selectedGroupData.rate.ratio)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/75">
                    {t("fieldCompletion")}
                  </p>
                  <span className="font-mono text-sm font-semibold">
                    {formatCompletionRatio(selectedGroupData.rate.completionRatio) ??
                      t("completionHidden")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/75">
                    {t("fieldTag")}
                  </p>
                  <span
                    className={cn(
                      tagBadgeClass(selectedGroupTag),
                      "inline-flex max-w-full truncate rounded-full border-0 px-2 py-0.5 text-xs"
                    )}
                  >
                    {selectedGroupTag || t("tagOther")}
                  </span>
                </div>
              </div>

              <div className="border-y border-border/50 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{t("colHealthModel")}</p>
                  {selectedGroupTag ? (
                    <span className="text-[11px] text-muted-foreground">
                      {t("groupHealthSharedHint", { tag: selectedGroupTag })}
                    </span>
                  ) : null}
                </div>
                {isAdmin && selectedGroupTag && selectedGroupTag !== "other" ? (
                  <Input
                    key={`${selectedGroupTag}-${selectedGroupHealthModel ?? ""}`}
                    defaultValue={selectedGroupHealthModel ?? ""}
                    className="mt-2 h-8 rounded-none border-x-0 border-t-0 border-b border-primary/40 bg-transparent px-0 font-mono text-xs shadow-none focus-visible:border-primary focus-visible:ring-0"
                    placeholder={t("healthModelPlaceholder")}
                    onBlur={(e: ChangeEvent<HTMLInputElement>) => {
                      const next = e.target.value.trim();
                      if (next !== (selectedGroupHealthModel ?? "")) {
                        void saveDispatchHealthModel(selectedGroupTag, next);
                      }
                    }}
                    onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                ) : (
                  <p className="mt-2 font-mono text-xs text-muted-foreground">
                    {selectedGroupHealthModel || t("healthModelEmpty")}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{t("groupHealthMembersTitle")}</p>
                    <p className="text-xs text-muted-foreground">{t("groupHealthDialogHint")}</p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium",
                      groupHealthIconClass(selectedGroupHealthState)
                    )}
                  >
                    {groupHealthIcon(selectedGroupHealthState)}
                    {groupHealthLabel(selectedGroupHealthState, tHealth)}
                  </span>
                </div>

                {selectedGroupData.members.length === 0 ? (
                  <div className="rounded-xl border border-dashed bg-muted/15 px-4 py-8 text-center text-sm text-muted-foreground">
                    {t("groupHealthNoMembers")}
                  </div>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    {selectedGroupData.members.map((provider) => {
                      const status = getProviderHealthTestStatus(
                        provider,
                        tHealth,
                        healthSloThresholds,
                        healthWindowSize
                      );
                      return (
                        <div
                          key={provider.id}
                          className="min-w-0 rounded-lg border border-border/60 bg-background p-2.5"
                        >
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <button
                              type="button"
                              className="min-w-0 truncate text-left text-sm font-medium hover:text-primary disabled:cursor-default disabled:hover:text-foreground"
                              onClick={() => onRequestEditProvider?.(provider.id)}
                              disabled={!onRequestEditProvider}
                            >
                              {provider.name}
                            </button>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "h-5 shrink-0 border px-1.5 text-[10px] font-medium",
                                  status.className
                                )}
                              >
                                {status.text}
                              </Badge>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 px-2 text-[11px]"
                                disabled={Boolean(manualTestingProviderIds[provider.id])}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleManualHealthTest(provider);
                                }}
                                aria-label={t("groupHealthManualTest")}
                              >
                                {manualTestingProviderIds[provider.id] ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Play className="h-3.5 w-3.5" />
                                )}
                                {t("groupHealthManualTest")}
                              </Button>
                            </div>
                          </div>
                          <ProviderHealthTestCard
                            provider={provider}
                            canEdit={isAdmin}
                            compact
                            hideStatusBadge
                            windowSize={healthWindowSize}
                            sloThresholds={healthSloThresholds}
                            className="border-0 bg-transparent p-0"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      <Dialog open={siteDialogOpen} onOpenChange={(open) => !open && setSiteDialogOpen(false)}>
        <DialogContent className="grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)] sm:max-w-2xl sm:rounded-2xl">
          <DialogHeader className="border-b bg-gradient-to-br from-muted/55 via-card to-card px-6 py-5 pr-14 text-left">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
                <Building2 className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-xl tracking-tight">
                  {editingSite ? t("editSite") : t("addSite")}
                </DialogTitle>
                <DialogDescription className="mt-1.5 max-w-2xl leading-6">
                  {t("siteDialogDesc")}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto">
            <div className="space-y-4 px-6 py-5">
              <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {t("fieldName")}
                    </label>
                    <Input
                      className="h-11 rounded-lg bg-background"
                      value={siteForm.name}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        setSiteForm((p) => ({ ...p, name: e.target.value }))
                      }
                      placeholder={t("fieldNamePlaceholder")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {t("fieldUrl")}
                    </label>
                    <Input
                      className="h-11 rounded-lg bg-background"
                      value={siteForm.siteUrl}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        setSiteForm((p) => ({ ...p, siteUrl: e.target.value }))
                      }
                      placeholder="https://example.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {t("fieldType")}
                    </label>
                    <Select
                      value={siteForm.siteType}
                      onValueChange={(value) =>
                        setSiteForm((p) => ({
                          ...p,
                          siteType: value as SiteFormState["siteType"],
                        }))
                      }
                    >
                      <SelectTrigger className="h-11 w-full rounded-lg bg-background sm:w-56">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sub2api">sub2api</SelectItem>
                        <SelectItem value="newapi">newapi</SelectItem>
                        <SelectItem value="custom">custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {t("fieldUsername")}
                    </label>
                    <Input
                      className="h-11 rounded-lg bg-background"
                      value={siteForm.username}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        setSiteForm((p) => ({ ...p, username: e.target.value }))
                      }
                      placeholder={t("fieldUsernamePlaceholder")}
                      autoComplete="username"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {t("fieldPassword")}
                    </label>
                    <Input
                      className="h-11 rounded-lg bg-background"
                      type="password"
                      value={siteForm.password}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        setSiteForm((p) => ({ ...p, password: e.target.value }))
                      }
                      placeholder={
                        editingSite?.hasPassword
                          ? t("fieldPasswordPlaceholder")
                          : t("fieldPassword")
                      }
                      autoComplete="new-password"
                    />
                    {editingSite?.hasPassword ? (
                      <p className="text-xs text-muted-foreground">{t("fieldPasswordSet")}</p>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-xl border border-sky-200/70 bg-sky-50/45 p-4 dark:border-sky-900/60 dark:bg-sky-950/20">
                <label htmlFor="site-turnstile" className="flex items-start gap-3">
                  <input
                    id="site-turnstile"
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    checked={siteForm.turnstileEnabled}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setSiteForm((p) => ({ ...p, turnstileEnabled: e.target.checked }))
                    }
                  />
                  <span className="text-sm font-medium leading-6">{t("fieldTurnstile")}</span>
                </label>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t("fieldCaptchaProvider")}
                  </label>
                  <Select
                    value={siteForm.captchaProvider}
                    onValueChange={(value) =>
                      setSiteForm((p) => ({
                        ...p,
                        captchaProvider: value as SiteFormState["captchaProvider"],
                      }))
                    }
                  >
                    <SelectTrigger className="h-11 w-full rounded-lg bg-background sm:w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="global">{t("captchaGlobal")}</SelectItem>
                      <SelectItem value="none">{t("captchaNone")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="rounded-lg bg-background/70 px-3 py-2 text-xs leading-5 text-muted-foreground">
                    {t("captchaGlobalHint")}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t("fieldNotes")}
                  </label>
                  <Input
                    className="h-11 rounded-lg bg-background"
                    value={siteForm.notes}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setSiteForm((p) => ({ ...p, notes: e.target.value }))
                    }
                    placeholder={t("fieldNotesPlaceholder")}
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="border-t bg-background/95 px-6 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div className="flex w-full sm:w-auto">
              {editingSite ? (
                <Button
                  variant="outline"
                  className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto"
                  onClick={() => setDeletingSite(editingSite)}
                  disabled={isSaving}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  {t("deleteSite")}
                </Button>
              ) : null}
            </div>
            <div className="flex w-full justify-end gap-2 sm:w-auto">
              <Button
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={() => setSiteDialogOpen(false)}
                disabled={isSaving}
              >
                {t("cancel")}
              </Button>
              <Button
                className="min-w-24 flex-1 sm:flex-none"
                onClick={handleSaveSite}
                disabled={isSaving}
              >
                {isSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                {t("save")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deletingSite)}
        onOpenChange={(open) => !open && setDeletingSite(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmDeleteDesc", { name: deletingSite?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteSite();
              }}
              disabled={isSaving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {t("deleteSite")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

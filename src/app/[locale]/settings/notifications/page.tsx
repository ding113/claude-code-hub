"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { GlobalSettingsCard } from "./_components/global-settings-card";
import { NotificationTypeCard } from "./_components/notification-type-card";
import { NotificationsSkeleton } from "./_components/notifications-skeleton";
import { WebhookTargetsSection } from "./_components/webhook-targets-section";
import { NOTIFICATION_TYPES, useNotificationsPageData } from "./_lib/hooks";

export default function NotificationsPage() {
  const t = useTranslations("settings");
  const {
    settings,
    targets,
    bindingsByType,
    isLoading,
    loadError,
    updateSettings,
    saveBindings,
    createTarget,
    updateTarget,
    deleteTarget,
    testTarget,
  } = useNotificationsPageData();

  const handleUpdateSettings = async (patch: any) => {
    const result = await updateSettings(patch);
    if (!result.ok) {
      toast.error(result.error || t("notifications.form.saveFailed"));
    }
    return result;
  };

  if (isLoading || !settings) {
    return <NotificationsSkeleton />;
  }

  return (
    <div className="space-y-4">
      <SettingsPageHeader
        title={t("notifications.title")}
        description={t("notifications.description")}
        icon="bell"
      />

      {loadError ? (
        <Alert variant="destructive">
          <AlertTitle>{t("notifications.form.loadError")}</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      <GlobalSettingsCard
        enabled={settings.enabled}
        onEnabledChange={async (enabled) => {
          await handleUpdateSettings({ enabled });
        }}
      />

      <WebhookTargetsSection
        targets={targets}
        onCreate={createTarget}
        onUpdate={updateTarget}
        onDelete={deleteTarget}
        onTest={testTarget}
      />

      <div className="grid gap-4">
        {NOTIFICATION_TYPES.map((type) => (
          <NotificationTypeCard
            key={type}
            type={type}
            settings={settings}
            targets={targets}
            bindings={bindingsByType[type]}
            onUpdateSettings={handleUpdateSettings}
            onSaveBindings={saveBindings}
          />
        ))}
      </div>
    </div>
  );
}

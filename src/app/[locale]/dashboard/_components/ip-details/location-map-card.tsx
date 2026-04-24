"use client";

import { MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { Map, MapControls, MapPopup } from "@/components/ui/map";

function resolveZoom(accuracyRadiusKm: number | null): number {
  if (accuracyRadiusKm === null) return 10.8;
  if (accuracyRadiusKm <= 1) return 13;
  if (accuracyRadiusKm <= 5) return 11.8;
  if (accuracyRadiusKm <= 25) return 10.6;
  return 9.8;
}

export function LocationMapCard({
  latitude,
  longitude,
  accuracyRadiusKm,
  title,
  subtitle,
}: {
  latitude: number;
  longitude: number;
  accuracyRadiusKm: number | null;
  title: string;
  subtitle?: string | null;
}) {
  const t = useTranslations("ipDetails");

  return (
    <div className="overflow-hidden rounded-xl border bg-background shadow-xs">
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <span className="rounded-full bg-primary/10 p-1 text-primary">
          <MapPin className="size-3.5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>

      <div className="h-52 sm:h-60">
        <Map
          viewport={{
            center: [longitude, latitude],
            zoom: resolveZoom(accuracyRadiusKm),
          }}
        >
          <MapPopup longitude={longitude} latitude={latitude} className="w-56">
            <div className="space-y-1">
              <p className="text-sm font-semibold">{title}</p>
              {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
              <p className="font-mono text-xs">
                {latitude.toFixed(4)}, {longitude.toFixed(4)}
              </p>
            </div>
          </MapPopup>
          <MapControls
            position="bottom-right"
            showZoom
            showCompass={false}
            showLocate={false}
            labels={{
              zoomIn: t("map.zoomIn"),
              zoomOut: t("map.zoomOut"),
              locate: t("map.locate"),
              fullscreen: t("map.fullscreen"),
              compass: t("map.resetBearing"),
            }}
          />
        </Map>
      </div>
    </div>
  );
}

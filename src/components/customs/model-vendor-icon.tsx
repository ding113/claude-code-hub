"use client";

import { useState } from "react";
import { accentColorOf, cloudModelIconUrl } from "@/lib/model-vendor/vendor-icon-files";
import { inferVendorFromModelName, UNKNOWN_VENDOR } from "@/lib/model-vendor/vendor-inference";
import { getVendorEntry, getVendorIconComponent } from "@/lib/model-vendor-icons";

interface ModelVendorIconProps {
  modelId: string;
  /** 云端价格表下发的 vendor slug(优先于按模型名推断) */
  vendor?: string | null;
  /** 云端价格表下发的图标文件基名(cch-plus.com/model-icons/<file>),优先直接使用 */
  iconFile?: string | null;
  /** 图标为单色时跟随暗色主题反色 */
  iconMono?: boolean;
  className?: string;
}

function MonogramIcon({ seed, className }: { seed: string; className: string }) {
  const initial = (/[a-z0-9]/i.exec(seed)?.[0] ?? "?").toUpperCase();
  const color = accentColorOf(seed);
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: `color-mix(in oklch, ${color} 15%, transparent)`, color }}
      className={`inline-flex items-center justify-center rounded-sm text-[0.55em] leading-none font-semibold select-none ${className}`}
    >
      {initial}
    </span>
  );
}

function RemoteVendorIcon({
  file,
  mono,
  fallbackSeed,
  className,
}: {
  file: string;
  mono: boolean;
  fallbackSeed: string;
  className: string;
}) {
  // 记录失败的具体文件而非布尔值:file 变化后自动重试新图标
  const [failedFile, setFailedFile] = useState<string | null>(null);
  if (failedFile === file) {
    return <MonogramIcon seed={fallbackSeed} className={className} />;
  }
  return (
    <img
      src={cloudModelIconUrl(file)}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={() => setFailedFile(file)}
      className={`select-none ${mono ? "dark:invert" : ""} ${className}`}
    />
  );
}

/**
 * 模型厂商图标。
 * 解析顺序:云端下发的 iconFile -> 本地打包组件(按 vendor)-> icon 映射表远程 SVG -> 字母 monogram。
 * vendor 未提供时按模型名正则推断(与云端价格表生成侧同一套规则)。
 */
export function ModelVendorIcon({
  modelId,
  vendor,
  iconFile,
  iconMono,
  className = "h-3.5 w-3.5 shrink-0",
}: ModelVendorIconProps) {
  const resolvedVendor = vendor?.trim() || inferVendorFromModelName(modelId);

  if (iconFile?.trim()) {
    // 云端价格表已解析好的图标:优先本地组件保证离线可用,否则直接用云端 SVG
    const component = getVendorIconComponent(resolvedVendor);
    if (component) {
      const Icon = component;
      return <Icon className={className} />;
    }
    return (
      <RemoteVendorIcon
        file={iconFile.trim()}
        mono={iconMono === true}
        fallbackSeed={resolvedVendor === UNKNOWN_VENDOR ? modelId : resolvedVendor}
        className={className}
      />
    );
  }

  if (resolvedVendor === UNKNOWN_VENDOR) {
    return <MonogramIcon seed={modelId} className={className} />;
  }

  const entry = getVendorEntry(resolvedVendor);
  if (entry.icon) {
    const Icon = entry.icon;
    return <Icon className={className} />;
  }
  if (entry.iconFile) {
    return (
      <RemoteVendorIcon
        file={entry.iconFile.file}
        mono={entry.iconFile.mono === true}
        fallbackSeed={resolvedVendor}
        className={className}
      />
    );
  }
  return <MonogramIcon seed={resolvedVendor} className={className} />;
}

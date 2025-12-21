import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { APP_VERSION, compareVersions, GITHUB_REPO } from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REVALIDATE_SECONDS = 5 * 60; // 5 分钟
const USER_AGENT = "claude-code-hub";

interface GitHubRelease {
  tag_name: string;
  name: string;
  html_url: string;
  published_at: string;
}

interface LatestVersionInfo {
  latest: string;
  releaseUrl?: string;
  publishedAt?: string;
}

function normalizeVersionForDisplay(version: string): string {
  const trimmed = version.trim();
  if (!trimmed) return trimmed;

  // Normalize leading "V" to lowercase.
  if (/^v/i.test(trimmed)) {
    return `v${trimmed.slice(1)}`;
  }

  // Only add "v" prefix for semver-like strings; keep other values (e.g. "dev") as-is.
  if (/^\d+(?:\.\d+)*(?:[-+].+)?$/.test(trimmed)) {
    return `v${trimmed}`;
  }

  return trimmed;
}

async function readLocalVersionFile(): Promise<string | null> {
  try {
    const content = await readFile(join(process.cwd(), "VERSION"), "utf8");
    const trimmed = content.trim();
    return trimmed ? normalizeVersionForDisplay(trimmed) : null;
  } catch {
    return null;
  }
}

async function getCurrentVersion(): Promise<string> {
  const fromEnv = process.env.NEXT_PUBLIC_APP_VERSION?.trim();
  if (fromEnv) return normalizeVersionForDisplay(fromEnv);

  const fromFile = await readLocalVersionFile();
  if (fromFile) return fromFile;

  return normalizeVersionForDisplay(APP_VERSION);
}

function getGitHubAuthToken(): string | null {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return token?.trim() || null;
}

function buildGitHubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": USER_AGENT,
  };

  const token = getGitHubAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function fetchLatestRelease(): Promise<GitHubRelease | null> {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO.owner}/${GITHUB_REPO.repo}/releases/latest`,
    {
      headers: buildGitHubHeaders(),
      next: {
        revalidate: REVALIDATE_SECONDS,
      },
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub API 错误: ${response.status}`);
  }

  return (await response.json()) as GitHubRelease;
}

async function fetchLatestVersionFromVersionFile(): Promise<string | null> {
  const response = await fetch(
    `https://raw.githubusercontent.com/${GITHUB_REPO.owner}/${GITHUB_REPO.repo}/main/VERSION`,
    {
      headers: {
        "User-Agent": USER_AGENT,
      },
      next: {
        revalidate: REVALIDATE_SECONDS,
      },
    }
  );

  if (!response.ok) {
    return null;
  }

  const version = (await response.text()).trim();
  return version ? normalizeVersionForDisplay(version) : null;
}

async function getLatestVersionInfo(): Promise<LatestVersionInfo | null> {
  try {
    const release = await fetchLatestRelease();
    if (!release) {
      const latest = await fetchLatestVersionFromVersionFile();
      if (!latest) return null;

      return {
        latest,
        releaseUrl: `https://github.com/${GITHUB_REPO.owner}/${GITHUB_REPO.repo}/releases/tag/${latest}`,
      };
    }

    return {
      latest: normalizeVersionForDisplay(release.tag_name),
      releaseUrl: release.html_url,
      publishedAt: release.published_at,
    };
  } catch (error) {
    // Fallback to VERSION file when GitHub API is rate-limited or blocked.
    const latest = await fetchLatestVersionFromVersionFile();
    if (!latest) {
      throw error;
    }

    return {
      latest,
      releaseUrl: `https://github.com/${GITHUB_REPO.owner}/${GITHUB_REPO.repo}/releases/tag/${latest}`,
    };
  }
}

/**
 * GET /api/version
 * 检查是否有新版本可用
 */
export async function GET() {
  try {
    const current = await getCurrentVersion();
    const latestInfo = await getLatestVersionInfo();

    if (!latestInfo) {
      return NextResponse.json({
        current,
        latest: null,
        hasUpdate: false,
        message: "暂无发布版本",
      });
    }

    const hasUpdate = compareVersions(current, latestInfo.latest) === 1;

    return NextResponse.json({
      current,
      latest: latestInfo.latest,
      hasUpdate,
      releaseUrl: latestInfo.releaseUrl,
      publishedAt: latestInfo.publishedAt,
    });
  } catch (error) {
    logger.error("版本检查失败:", error);
    return NextResponse.json(
      {
        current: normalizeVersionForDisplay(APP_VERSION),
        latest: null,
        hasUpdate: false,
        error: "无法获取最新版本信息",
      },
      { status: 500 }
    );
  }
}

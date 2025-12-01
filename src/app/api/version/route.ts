import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { APP_VERSION, compareVersions, GITHUB_REPO } from "@/lib/version";

export const runtime = "edge";
export const dynamic = "force-dynamic";

interface GitHubRelease {
  tag_name: string;
  name: string;
  html_url: string;
  published_at: string;
}

/**
 * GET /api/version
 * 检查是否有新版本可用
 */
export async function GET() {
  try {
    // 获取 GitHub 最新 release
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO.owner}/${GITHUB_REPO.repo}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "claude-code-hub",
        },
        next: {
          revalidate: 3600, // 缓存 1 小时
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json({
          current: APP_VERSION,
          latest: null,
          hasUpdate: false,
          message: "暂无发布版本",
        });
      }
      throw new Error(`GitHub API 错误: ${response.status}`);
    }

    const release: GitHubRelease = await response.json();
    const latestVersion = release.tag_name;

    // 比较版本
    const hasUpdate = compareVersions(APP_VERSION, latestVersion) === 1;

    return NextResponse.json({
      current: APP_VERSION,
      latest: latestVersion,
      hasUpdate,
      releaseUrl: release.html_url,
      publishedAt: release.published_at,
    });
  } catch (error) {
    logger.error("版本检查失败:", error);
    return NextResponse.json(
      {
        current: APP_VERSION,
        latest: null,
        hasUpdate: false,
        error: "无法获取最新版本信息",
      },
      { status: 500 }
    );
  }
}

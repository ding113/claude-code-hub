import { ClientVersionChecker } from "@/lib/client-version-checker";
import { logger } from "@/lib/logger";
import { getClientTypeDisplayName, parseUserAgent } from "@/lib/ua-parser";
import { getSystemSettings } from "@/repository/system-config";
import type { ProxySession } from "./session";

/**
 * 代理版本检查守卫
 *
 * 职责：
 * 1. 检查是否启用客户端版本检查
 * 2. 解析客户端 UA 并提取版本信息
 * 3. 检查用户版本是否需要升级
 * 4. 异步更新用户版本追踪
 * 5. 拦截旧版本用户或放行
 *
 * 特点：
 * - Fail Open: 任何错误都放行，不影响服务
 * - 默认关闭: 配置关闭时跳过所有检查
 * - 向后兼容: UA 解析失败时放行
 */
export class ProxyVersionGuard {
  /**
   * 检查客户端版本，必要时拦截请求
   *
   * @param session - 代理会话
   * @returns Response: 需要拦截时返回 HTTP 400, null: 放行
   */
  static async ensure(session: ProxySession): Promise<Response | null> {
    try {
      // 1. 检查系统配置
      const settings = await getSystemSettings();
      if (!settings.enableClientVersionCheck) {
        logger.debug("[ProxyVersionGuard] 版本检查功能已关闭");
        return null; // 功能关闭，放行
      }

      // 2. 确保已认证（authState 在认证后设置）
      if (!session.authState || !session.authState.user) {
        logger.debug("[ProxyVersionGuard] 未认证用户，跳过版本检查");
        return null; // 未认证，放行（不应该发生，因为在认证后执行）
      }

      // 3. 解析 UA
      const clientInfo = parseUserAgent(session.userAgent);
      if (!clientInfo) {
        logger.debug({ ua: session.userAgent }, "[ProxyVersionGuard] UA 解析失败，放行");
        return null; // 解析失败，向后兼容
      }

      const userId = session.authState.user.id;

      logger.debug(
        {
          userId,
          clientType: clientInfo.clientType,
          version: clientInfo.version,
        },
        "[ProxyVersionGuard] 开始版本检查"
      );

      // 4. 异步更新用户版本（不阻塞主流程）
      ClientVersionChecker.updateUserVersion(
        userId,
        clientInfo.clientType,
        clientInfo.version
      ).catch((err) => {
        logger.error({ err }, "[ProxyVersionGuard] 更新用户版本失败");
      });

      // 5. 检查是否需要升级（同时获取 GA 版本，避免重复查询）
      const { needsUpgrade, gaVersion } = await ClientVersionChecker.shouldUpgrade(
        clientInfo.clientType,
        clientInfo.version
      );

      if (!needsUpgrade) {
        logger.debug(
          { clientType: clientInfo.clientType, version: clientInfo.version },
          "[ProxyVersionGuard] 版本检查通过"
        );
        return null; // 版本符合要求，放行
      }

      // 6. 构建错误提示（重用第 5 步获取的 gaVersion，避免重复查询）
      const clientDisplayName = getClientTypeDisplayName(clientInfo.clientType);

      logger.warn(
        {
          userId,
          clientType: clientInfo.clientType,
          currentVersion: clientInfo.version,
          requiredVersion: gaVersion,
        },
        "[ProxyVersionGuard] 客户端版本过旧，已拦截"
      );

      // 7. 返回 HTTP 400 + 明确的升级提示
      return new Response(
        JSON.stringify({
          error: {
            type: "client_upgrade_required",
            message: `Your ${clientDisplayName} (v${clientInfo.version}) is outdated. Please upgrade to v${gaVersion} or later to continue using this service.`,
            current_version: clientInfo.version,
            required_version: gaVersion,
            client_type: clientInfo.clientType,
            client_display_name: clientDisplayName,
          },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      // Fail Open: 任何错误都放行
      logger.error({ error }, "[ProxyVersionGuard] 版本检查失败，放行请求");
      return null;
    }
  }
}

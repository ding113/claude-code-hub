#!/usr/bin/env node

/**
 * Claude Code Hub - Docker 更新管理脚本
 * 提供交互式菜单来管理 Docker 镜像更新、备份、回滚等操作
 */

import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// 颜色输出工具
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, "green");
}

function logError(message) {
  log(`❌ ${message}`, "red");
}

function logWarning(message) {
  log(`⚠️  ${message}`, "yellow");
}

function logInfo(message) {
  log(`ℹ️  ${message}`, "cyan");
}

function logStep(message) {
  log(`\n🔹 ${message}`, "bright");
}

// 执行命令工具
function execCommand(command, options = {}) {
  try {
    const result = execSync(command, {
      encoding: "utf-8",
      stdio: options.silent ? "pipe" : "inherit",
      ...options,
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, error: error.message, output: error.stdout };
  }
}

// 检查 Docker 环境
function checkDockerEnvironment() {
  logStep("检查 Docker 环境...");

  // 检查 docker 命令
  const dockerCheck = execCommand("docker --version", { silent: true });
  if (!dockerCheck.success) {
    logError("Docker 未安装或未启动");
    return false;
  }
  logInfo(`Docker 版本: ${dockerCheck.output.trim()}`);

  // 检查 docker compose
  const composeCheck = execCommand("docker compose version", { silent: true });
  if (!composeCheck.success) {
    logError("Docker Compose 未安装");
    return false;
  }
  logInfo(`Docker Compose 版本: ${composeCheck.output.trim()}`);

  // 检查 docker-compose.yaml 文件
  if (!existsSync("docker-compose.yaml")) {
    logError("未找到 docker-compose.yaml 文件");
    logWarning("请在项目根目录运行此脚本");
    return false;
  }

  logSuccess("Docker 环境检查通过");
  return true;
}

// 获取当前镜像信息
function getCurrentImageInfo() {
  logStep("获取当前镜像信息...");

  const result = execCommand("docker compose images --format json", { silent: true });

  if (result.success && result.output) {
    try {
      const images = result.output
        .trim()
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

      const appImage = images.find((img) => img.Service === "app");
      if (appImage) {
        logInfo(`当前应用镜像: ${appImage.Repository}:${appImage.Tag}`);
        logInfo(`镜像 ID: ${appImage.ID}`);
        return appImage;
      }
    } catch (error) {
      logWarning("无法解析镜像信息");
    }
  }

  return null;
}

// 备份数据
async function backupData(rl) {
  logStep("数据备份");

  const answer = await rl.question("是否需要备份数据？(y/n，默认 y): ");
  if (answer.toLowerCase() === "n") {
    logWarning("跳过数据备份");
    return true;
  }

  const backupDir = "./backups";
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const backupFile = join(backupDir, `data_backup_${timestamp}.tar.gz`);

  logInfo("正在备份数据目录...");
  const result = execCommand(`tar -czf "${backupFile}" ./data`);

  if (result.success) {
    logSuccess(`数据已备份到: ${backupFile}`);
    return true;
  } else {
    logError("数据备份失败");
    return false;
  }
}

// 拉取最新镜像
function pullLatestImage() {
  logStep("拉取最新镜像...");

  const result = execCommand("docker compose pull app");

  if (result.success) {
    logSuccess("镜像拉取成功");
    return true;
  } else {
    logError("镜像拉取失败");
    return false;
  }
}

// 重启服务
function restartServices() {
  logStep("重启服务...");

  const result = execCommand("docker compose up -d");

  if (result.success) {
    logSuccess("服务已重启");
    return true;
  } else {
    logError("服务重启失败");
    return false;
  }
}

// 查看服务状态
function checkServiceStatus() {
  logStep("检查服务状态...");

  execCommand("docker compose ps");

  // 等待健康检查
  logInfo("\n等待健康检查...");
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const result = execCommand(
      'docker inspect claude-code-hub-app --format="{{.State.Health.Status}}"',
      { silent: true }
    );

    if (result.success) {
      const status = result.output.trim().replace(/"/g, "");
      if (status === "healthy") {
        logSuccess("服务健康检查通过");
        return true;
      }
      logInfo(`健康状态: ${status} (${attempts + 1}/${maxAttempts})`);
    }

    attempts++;
    execSync("sleep 3");
  }

  logWarning("健康检查超时，请手动检查服务状态");
  return false;
}

// 查看日志
function viewLogs(lines = 50) {
  logStep(`查看最近 ${lines} 行日志...`);
  execCommand(`docker compose logs --tail=${lines} app`);
}

// 查看实时日志
function viewLogsFollow() {
  logStep("查看实时日志（按 Ctrl+C 退出）...");

  const child = spawn("docker", ["compose", "logs", "-f", "app"], {
    stdio: "inherit",
  });

  return new Promise((resolve) => {
    child.on("close", () => {
      resolve();
    });
  });
}

// 获取应用镜像名称（从 docker-compose.yaml 提取）
function getAppImageName() {
  const result = execCommand("docker compose config --format json", { silent: true });

  if (result.success && result.output) {
    try {
      const config = JSON.parse(result.output);
      const appService = config.services?.app;
      if (appService?.image) {
        // 提取镜像名（不含标签）
        return appService.image.split(":")[0];
      }
    } catch (error) {
      logWarning("无法解析 docker-compose.yaml 配置");
    }
  }

  // 回退到默认值
  return "ghcr.io/ding113/claude-code-hub";
}

// 清理旧镜像
async function cleanupOldImages(rl) {
  logStep("清理旧镜像");

  const imageName = getAppImageName();

  // 显示当前镜像
  logInfo("当前 Docker 镜像:");
  execCommand(`docker images ${imageName}`);

  const answer = await rl.question("\n是否清理未使用的镜像？(y/n): ");
  if (answer.toLowerCase() !== "y") {
    logWarning("跳过镜像清理");
    return;
  }

  logInfo("清理悬空镜像...");
  execCommand("docker image prune -f");

  logSuccess("镜像清理完成");
}

// 回滚到旧版本
async function rollbackVersion(rl) {
  logStep("回滚到旧版本");

  const imageName = getAppImageName();

  // 显示可用的镜像
  logInfo("本地可用的镜像:");
  const result = execCommand(
    `docker images ${imageName} --format "{{.Tag}}\t{{.ID}}\t{{.CreatedAt}}"`,
    { silent: true }
  );

  if (result.success && result.output) {
    console.log(result.output);
  }

  const tag = await rl.question("\n请输入要回滚的镜像标签（如 v0.4.10）: ");
  if (!tag || tag.trim() === "") {
    logWarning("未输入标签，取消回滚");
    return;
  }

  logInfo(`回滚到版本: ${tag}`);

  // 修改 docker-compose.yaml 中的镜像标签
  logWarning("请手动编辑 docker-compose.yaml，将镜像标签改为: " + tag);
  logInfo("或者使用以下命令:");
  console.log(`  sed -i 's|${imageName}:.*|${imageName}:${tag}|' docker-compose.yaml`);

  const confirm = await rl.question("\n已修改完成？继续重启服务？(y/n): ");
  if (confirm.toLowerCase() === "y") {
    restartServices();
    checkServiceStatus();
  }
}

// 一键更新（推荐流程）
async function quickUpdate(rl) {
  log("\n" + "=".repeat(60), "cyan");
  log("🚀 开始一键更新流程", "bright");
  log("=".repeat(60), "cyan");

  // 1. 检查环境
  if (!checkDockerEnvironment()) {
    return;
  }

  // 2. 显示当前镜像信息
  getCurrentImageInfo();

  // 3. 备份数据
  const backupSuccess = await backupData(rl);
  if (!backupSuccess) {
    const continueAnyway = await rl.question("备份失败，是否继续更新？(y/n): ");
    if (continueAnyway.toLowerCase() !== "y") {
      logWarning("已取消更新");
      return;
    }
  }

  // 4. 拉取最新镜像
  if (!pullLatestImage()) {
    logError("镜像拉取失败，更新终止");
    return;
  }

  // 5. 重启服务
  if (!restartServices()) {
    logError("服务重启失败，请手动检查");
    return;
  }

  // 6. 检查服务状态
  checkServiceStatus();

  // 7. 显示日志
  const showLogs = await rl.question("\n是否查看服务日志？(y/n): ");
  if (showLogs.toLowerCase() === "y") {
    viewLogs(50);
  }

  log("\n" + "=".repeat(60), "green");
  logSuccess("更新流程完成！");
  log("=".repeat(60), "green");
  logInfo("访问地址: http://localhost:23000");
  logInfo("API 文档: http://localhost:23000/api/actions/scalar");
}

// 显示主菜单
function showMenu() {
  console.clear();
  log("\n╔════════════════════════════════════════════════════════════╗", "cyan");
  log("║       Claude Code Hub - Docker 更新管理工具               ║", "bright");
  log("╚════════════════════════════════════════════════════════════╝", "cyan");

  console.log("\n请选择操作：\n");

  log("  1. 🚀 一键更新（推荐）", "green");
  console.log("     - 自动备份数据");
  console.log("     - 拉取最新镜像");
  console.log("     - 重启服务并检查健康状态\n");

  log("  2. 📦 仅拉取最新镜像", "yellow");
  console.log("     - 不重启服务，仅下载镜像\n");

  log("  3. 🔄 重启服务", "yellow");
  console.log("     - 使用当前镜像重启\n");

  log("  4. 📊 查看服务状态", "blue");
  console.log("     - 显示容器状态和健康检查\n");

  log("  5. 📝 查看日志", "blue");
  console.log("     - 查看最近 50 行日志\n");

  log("  6. 📡 查看实时日志", "blue");
  console.log("     - 实时跟踪日志输出\n");

  log("  7. 💾 备份数据", "magenta");
  console.log("     - 备份数据库和 Redis 数据\n");

  log("  8. 🔙 回滚到旧版本", "red");
  console.log("     - 切换到之前的镜像版本\n");

  log("  9. 🧹 清理旧镜像", "yellow");
  console.log("     - 删除未使用的镜像释放空间\n");

  log("  0. 🚪 退出", "red");
  console.log("");
}

// 主函数
async function main() {
  const rl = readline.createInterface({ input, output });

  try {
    let running = true;

    while (running) {
      showMenu();

      const choice = await rl.question("请输入选项 (0-9): ");

      switch (choice.trim()) {
        case "1":
          await quickUpdate(rl);
          break;

        case "2":
          pullLatestImage();
          break;

        case "3":
          restartServices();
          checkServiceStatus();
          break;

        case "4":
          checkServiceStatus();
          break;

        case "5":
          viewLogs(50);
          break;

        case "6":
          await viewLogsFollow();
          break;

        case "7":
          await backupData(rl);
          break;

        case "8":
          await rollbackVersion(rl);
          break;

        case "9":
          await cleanupOldImages(rl);
          break;

        case "0":
          log("\n👋 感谢使用，再见！", "cyan");
          running = false;
          break;

        default:
          logWarning("无效的选项，请重新选择");
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue;
      }

      if (running && choice !== "6") {
        await rl.question("\n按 Enter 键继续...");
      }
    }
  } catch (error) {
    logError(`发生错误: ${error.message}`);
  } finally {
    rl.close();
  }
}

// 启动脚本
main().catch((error) => {
  logError(`脚本执行失败: ${error.message}`);
  process.exit(1);
});

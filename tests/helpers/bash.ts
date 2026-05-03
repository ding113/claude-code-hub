import { execFileSync } from "node:child_process";

type BashCommand = {
  command: string;
  argsPrefix: string[];
};

type RunBashOptions = {
  env?: NodeJS.ProcessEnv;
  label?: string;
  requiredFunctions?: string[];
  setup?: string;
  timeoutMs?: number;
};

let cachedBashCommand: BashCommand | null = null;

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isLegacyWindowsBash(path: string): boolean {
  const normalized = path.replace(/\//g, "\\").toLowerCase();
  return (
    normalized.endsWith("\\windows\\system32\\bash.exe") ||
    normalized.endsWith("\\windows\\sysnative\\bash.exe") ||
    normalized.endsWith("\\microsoft\\windowsapps\\bash.exe")
  );
}

function windowsCommandExists(command: string): boolean {
  try {
    execFileSync("where.exe", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function resolveWindowsBashCommand(): BashCommand {
  const candidates = (() => {
    try {
      return splitLines(execFileSync("where.exe", ["bash"], { encoding: "utf8" }));
    } catch {
      return [];
    }
  })();
  const nativeBash = candidates.find((candidate) => !isLegacyWindowsBash(candidate));

  if (nativeBash) {
    return {
      command: nativeBash,
      argsPrefix: ["--noprofile", "--norc", "-c"],
    };
  }

  // Windows 的旧 bash.exe / WindowsApps alias 会提前改写 -c 脚本里的 $1/$@。
  // 通过 wsl.exe --exec 直接启动 Linux bash,保留 shell 函数体原文。
  if (windowsCommandExists("wsl.exe")) {
    return {
      command: "wsl.exe",
      argsPrefix: ["--exec", "bash", "--noprofile", "--norc", "-c"],
    };
  }

  return {
    command: "bash",
    argsPrefix: ["--noprofile", "--norc", "-c"],
  };
}

function resolveBashCommand(): BashCommand {
  if (cachedBashCommand) return cachedBashCommand;

  cachedBashCommand =
    process.platform === "win32"
      ? resolveWindowsBashCommand()
      : {
          command: "bash",
          argsPrefix: ["--noprofile", "--norc", "-c"],
        };
  return cachedBashCommand;
}

function makeShellEnv(extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === "BASH_ENV" || key === "ENV" || key === "SHELLOPTS") continue;
    if (key.startsWith("BASH_FUNC_")) continue;
    env[key] = value;
  }

  return {
    ...env,
    ...extraEnv,
    NO_COLOR: "1",
  };
}

function buildFunctionAssertions(requiredFunctions: string[] | undefined): string {
  if (!requiredFunctions?.length) return "";

  const quotedFunctions = requiredFunctions.map((name) => `"${name}"`).join(" ");
  return `
for __cch_required_function in ${quotedFunctions}; do
  if ! declare -F "$__cch_required_function" >/dev/null; then
    printf 'CCH shell helper failed: required function %s was not loaded\\n' "$__cch_required_function" >&2
    printf '  bash: %s\\n' "$BASH_VERSION" >&2
    printf '  pwd: %s\\n' "$PWD" >&2
    printf '  script root listing:\\n' >&2
    ls -la scripts >&2 || true
    exit 127
  fi
done
unset __cch_required_function
`;
}

export function runBashScript(scriptBody: string, options: RunBashOptions = {}): string {
  const { command, argsPrefix } = resolveBashCommand();
  const script = `
set -euo pipefail
${options.setup ?? ""}
${buildFunctionAssertions(options.requiredFunctions)}
${scriptBody}
`;

  try {
    return execFileSync(command, [...argsPrefix, script], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: makeShellEnv(options.env),
      timeout: options.timeoutMs ?? 20_000,
    }).trim();
  } catch (error) {
    const shellError = error as Error & {
      status?: number;
      stderr?: Buffer | string;
      stdout?: Buffer | string;
    };
    const stdout = shellError.stdout?.toString() ?? "";
    const stderr = shellError.stderr?.toString() ?? "";
    const details = [
      `CCH shell helper failed${options.label ? ` (${options.label})` : ""}`,
      `command: ${[command, ...argsPrefix].join(" ")}`,
      `cwd: ${process.cwd()}`,
      `status: ${shellError.status ?? "unknown"}`,
      stdout ? `stdout:\n${stdout.trimEnd()}` : "",
      stderr ? `stderr:\n${stderr.trimEnd()}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    throw new Error(details, { cause: error });
  }
}

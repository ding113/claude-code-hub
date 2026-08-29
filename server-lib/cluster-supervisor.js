"use strict";

const { WORKER_READY_MESSAGE_TYPE, buildWorkerEnvironment } = require("./multicore");

const DEFAULT_READY_TIMEOUT_MS = 180_000;
const DEFAULT_RESTART_WINDOW_MS = 60_000;
const DEFAULT_MAX_RESTARTS_PER_WINDOW = 5;
const DEFAULT_RESTART_BASE_DELAY_MS = 250;
const DEFAULT_RESTART_MAX_DELAY_MS = 10_000;
const DEFAULT_FORCE_EXIT_GRACE_MS = 1_000;
const DEFAULT_READY_KILL_GRACE_MS = 5_000;
const DEFAULT_WORKER_ERROR_EXIT_GRACE_MS = 1_000;

function parsePositiveInteger(raw, fallback, name) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = Number(String(raw).trim());
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function resolveSupervisorSettings(env = process.env) {
  const workerHardExitMs = parsePositiveInteger(
    env.SHUTDOWN_HARD_EXIT_MS,
    28_000,
    "SHUTDOWN_HARD_EXIT_MS"
  );
  const shutdownTimeoutMs = parsePositiveInteger(
    env.CCH_MULTICORE_SHUTDOWN_TIMEOUT_MS,
    workerHardExitMs + 5_000,
    "CCH_MULTICORE_SHUTDOWN_TIMEOUT_MS"
  );
  if (shutdownTimeoutMs <= workerHardExitMs) {
    throw new Error(
      "CCH_MULTICORE_SHUTDOWN_TIMEOUT_MS must exceed SHUTDOWN_HARD_EXIT_MS"
    );
  }
  return {
    readyTimeoutMs: parsePositiveInteger(
      env.CCH_MULTICORE_READY_TIMEOUT_MS,
      DEFAULT_READY_TIMEOUT_MS,
      "CCH_MULTICORE_READY_TIMEOUT_MS"
    ),
    readyKillGraceMs: DEFAULT_READY_KILL_GRACE_MS,
    shutdownTimeoutMs,
    restartWindowMs: DEFAULT_RESTART_WINDOW_MS,
    maxRestartsPerWindow: DEFAULT_MAX_RESTARTS_PER_WINDOW,
    restartBaseDelayMs: DEFAULT_RESTART_BASE_DELAY_MS,
    restartMaxDelayMs: DEFAULT_RESTART_MAX_DELAY_MS,
    forceExitGraceMs: DEFAULT_FORCE_EXIT_GRACE_MS,
    workerErrorExitGraceMs: DEFAULT_WORKER_ERROR_EXIT_GRACE_MS,
  };
}

function createClusterSupervisor(options) {
  if (!options?.clusterModule || typeof options.clusterModule.fork !== "function") {
    throw new TypeError("clusterModule with fork() is required");
  }
  if (!options.plan?.enabled || options.plan.workerCount < 2) {
    throw new TypeError("An enabled multicore plan with at least two workers is required");
  }

  const clusterModule = options.clusterModule;
  const plan = options.plan;
  const processRef = options.processRef || process;
  const log = typeof options.log === "function" ? options.log : () => {};
  const now = typeof options.now === "function" ? options.now : Date.now;
  const setTimer = options.setTimeoutFn || setTimeout;
  const clearTimer = options.clearTimeoutFn || clearTimeout;
  const exit = options.exit || ((code) => processRef.exit(code));
  const settings = {
    ...resolveSupervisorSettings(options.env || processRef.env),
    ...(options.settings || {}),
  };

  const workersBySlot = new Map();
  const restartTimers = new Map();
  const crashTimesBySlot = new Map();
  let started = false;
  let shuttingDown = false;
  let secondaryWorkersStarted = false;
  let shutdownSignal = null;
  let requestedExitCode = 0;
  let shutdownTimer = null;
  let forceExitTimer = null;
  let exited = false;

  function safeClearTimer(timer) {
    if (timer !== null && timer !== undefined) clearTimer(timer);
  }

  function clearWorkerTimers(record) {
    safeClearTimer(record.readyTimer);
    safeClearTimer(record.terminationTimer);
    safeClearTimer(record.exitFallbackTimer);
    record.readyTimer = null;
    record.terminationTimer = null;
    record.exitFallbackTimer = null;
  }

  function emitLog(level, event, payload = {}) {
    log(level, event, payload);
  }

  function workerPid(worker) {
    return worker?.process?.pid ?? null;
  }

  function finishPrimary(code) {
    if (exited) return;
    exited = true;
    safeClearTimer(shutdownTimer);
    safeClearTimer(forceExitTimer);
    emitLog(code === 0 ? "info" : "error", "multicore_primary_exit", { code });
    exit(code);
  }

  function maybeFinishShutdown() {
    if (!shuttingDown || workersBySlot.size > 0 || restartTimers.size > 0) return;
    finishPrimary(requestedExitCode);
  }

  function sendWorkerSignal(worker, signal) {
    try {
      if (worker?.process && typeof worker.process.kill === "function") {
        worker.process.kill(signal);
        return true;
      }
      if (typeof worker?.kill === "function") {
        worker.kill(signal);
        return true;
      }
    } catch (error) {
      emitLog("warn", "multicore_worker_signal_failed", {
        pid: workerPid(worker),
        signal,
        error: String(error?.message || error),
      });
    }
    return false;
  }

  function beginShutdown(signal, exitCode = 0, reason = "signal") {
    if (shuttingDown) {
      requestedExitCode = Math.max(requestedExitCode, exitCode);
      return;
    }
    shuttingDown = true;
    shutdownSignal = signal;
    requestedExitCode = exitCode;
    emitLog("info", "multicore_shutdown_started", {
      signal,
      reason,
      workers: workersBySlot.size,
      timeoutMs: settings.shutdownTimeoutMs,
    });

    for (const timer of restartTimers.values()) safeClearTimer(timer);
    restartTimers.clear();
    for (const record of workersBySlot.values()) {
      clearWorkerTimers(record);
      sendWorkerSignal(record.worker, signal);
    }

    if (workersBySlot.size === 0) {
      maybeFinishShutdown();
      return;
    }

    shutdownTimer = setTimer(() => {
      requestedExitCode = 1;
      emitLog("error", "multicore_shutdown_timeout", {
        timeoutMs: settings.shutdownTimeoutMs,
        remainingWorkers: workersBySlot.size,
      });
      for (const record of workersBySlot.values()) {
        sendWorkerSignal(record.worker, "SIGKILL");
      }
      if (workersBySlot.size === 0) {
        maybeFinishShutdown();
        return;
      }
      forceExitTimer = setTimer(() => finishPrimary(1), settings.forceExitGraceMs);
    }, settings.shutdownTimeoutMs);
  }

  function recordCrash(slot, details) {
    const cutoff = now() - settings.restartWindowMs;
    const crashTimes = (crashTimesBySlot.get(slot) || []).filter((value) => value >= cutoff);
    crashTimes.push(now());
    crashTimesBySlot.set(slot, crashTimes);

    emitLog("warn", "multicore_worker_exited", {
      workerIndex: slot,
      restartCount: crashTimes.length,
      restartWindowMs: settings.restartWindowMs,
      ...details,
    });

    if (crashTimes.length >= settings.maxRestartsPerWindow) {
      emitLog("error", "multicore_worker_crash_loop", {
        workerIndex: slot,
        crashes: crashTimes.length,
        restartWindowMs: settings.restartWindowMs,
      });
      beginShutdown("SIGTERM", 1, "worker_crash_loop");
      return null;
    }
    return crashTimes.length;
  }

  function scheduleRestart(slot, failureCount) {
    if (shuttingDown || restartTimers.has(slot)) return;
    const delayMs = Math.min(
      settings.restartBaseDelayMs * 2 ** Math.max(0, failureCount - 1),
      settings.restartMaxDelayMs
    );
    emitLog("info", "multicore_worker_restart_scheduled", {
      workerIndex: slot,
      delayMs,
    });
    const timer = setTimer(() => {
      restartTimers.delete(slot);
      forkSlot(slot);
    }, delayMs);
    restartTimers.set(slot, timer);
  }

  function handleWorkerExit(record, code, signal, metadata = {}) {
    if (workersBySlot.get(record.slot) !== record) return;
    clearWorkerTimers(record);
    workersBySlot.delete(record.slot);

    if (shuttingDown) {
      if (typeof code === "number" && code !== 0) requestedExitCode = 1;
      emitLog("info", "multicore_worker_stopped", {
        workerIndex: record.slot,
        pid: workerPid(record.worker),
        code: code ?? null,
        signal: signal ?? null,
        shutdownSignal,
        ...metadata,
      });
      maybeFinishShutdown();
      return;
    }

    const failureCount = recordCrash(record.slot, {
      pid: workerPid(record.worker),
      code: code ?? null,
      signal: signal ?? null,
      ready: record.ready,
      terminationReason: record.terminationReason,
      ...metadata,
    });
    if (failureCount !== null) scheduleRestart(record.slot, failureCount);
  }

  function forceKillWorkerAndBoundExit(record, reason, event, payload = {}) {
    if (workersBySlot.get(record.slot) !== record || shuttingDown) return;

    emitLog("error", event, {
      workerIndex: record.slot,
      pid: workerPid(record.worker),
      ...payload,
    });
    sendWorkerSignal(record.worker, "SIGKILL");
    if (workersBySlot.get(record.slot) !== record || shuttingDown) return;
    record.exitFallbackTimer = setTimer(() => {
      if (workersBySlot.get(record.slot) !== record || shuttingDown) return;
      emitLog("error", "multicore_worker_exit_missing", {
        workerIndex: record.slot,
        pid: workerPid(record.worker),
        reason,
        graceMs: settings.forceExitGraceMs,
      });
      // child_process 不保证 error 后仍触发 exit。强杀后若仍缺少 exit，
      // 合成一次终态释放 slot；迟到的真实 exit 会被 record 身份检查忽略。
      handleWorkerExit(record, null, "SIGKILL", {
        synthetic: true,
        terminationReason: reason,
      });
    }, settings.forceExitGraceMs);
  }

  function handleWorkerError(record, error) {
    // cluster.Worker 会把异步 spawn/IPC 错误作为 `error` 事件抛出。这里必须
    // 消费该事件以免 EventEmitter 击穿 primary；崩溃计数与重启仍统一由
    // `exit` 路径负责，避免同一次故障被重复计数或重复拉起。
    if (workersBySlot.get(record.slot) !== record) return;
    emitLog("error", "multicore_worker_error", {
      workerIndex: record.slot,
      pid: workerPid(record.worker),
      ready: record.ready,
      shuttingDown,
      error: String(error?.message || error),
    });
    if (shuttingDown || record.terminationReason !== null) return;

    // Node 不保证 error 之后仍会触发 exit。先给自然 exit 一个短窗口，
    // 再强杀并由统一 exit 路径有界完成 slot 回收。
    record.terminationReason = "worker_error";
    safeClearTimer(record.readyTimer);
    record.readyTimer = null;
    record.terminationTimer = setTimer(() => {
      forceKillWorkerAndBoundExit(
        record,
        "worker_error",
        "multicore_worker_error_force_kill",
        { graceMs: settings.workerErrorExitGraceMs }
      );
    }, settings.workerErrorExitGraceMs);
  }

  function handleWorkerReady(record, message) {
    if (
      message?.type !== WORKER_READY_MESSAGE_TYPE ||
      workersBySlot.get(record.slot) !== record ||
      record.ready ||
      shuttingDown
    ) {
      return;
    }
    if (record.startupTimedOut) {
      emitLog("warn", "multicore_worker_ready_after_timeout", {
        workerIndex: record.slot,
        pid: workerPid(record.worker),
      });
      return;
    }
    if (record.terminationReason !== null) return;
    record.ready = true;
    clearWorkerTimers(record);
    emitLog("info", "multicore_worker_ready", {
      workerIndex: record.slot,
      pid: workerPid(record.worker),
      backgroundOwner: record.slot === 0,
    });

    if (record.slot === 0 && !secondaryWorkersStarted) {
      secondaryWorkersStarted = true;
      for (let slot = 1; slot < plan.workerCount; slot += 1) forkSlot(slot);
    }

    if (workersBySlot.size === plan.workerCount) {
      const readyCount = Array.from(workersBySlot.values()).filter((item) => item.ready).length;
      if (readyCount === plan.workerCount) {
        emitLog("info", "multicore_cluster_ready", { workerCount: plan.workerCount });
      }
    }
  }

  function forkSlot(slot) {
    if (shuttingDown || workersBySlot.has(slot)) return null;

    let worker;
    try {
      worker = clusterModule.fork(buildWorkerEnvironment(plan, slot));
    } catch (error) {
      const failureCount = recordCrash(slot, {
        pid: null,
        code: null,
        signal: null,
        ready: false,
        error: String(error?.message || error),
      });
      if (failureCount !== null) scheduleRestart(slot, failureCount);
      return null;
    }

    const record = {
      slot,
      worker,
      ready: false,
      startupTimedOut: false,
      terminationReason: null,
      readyTimer: null,
      terminationTimer: null,
      exitFallbackTimer: null,
    };
    workersBySlot.set(slot, record);
    worker.on("message", (message) => handleWorkerReady(record, message));
    worker.on("error", (error) => handleWorkerError(record, error));
    worker.once("exit", (code, signal) => handleWorkerExit(record, code, signal));
    record.readyTimer = setTimer(() => {
      if (workersBySlot.get(slot) !== record || record.ready || shuttingDown) return;
      record.startupTimedOut = true;
      record.terminationReason = "ready_timeout";
      emitLog("error", "multicore_worker_ready_timeout", {
        workerIndex: slot,
        pid: workerPid(worker),
        timeoutMs: settings.readyTimeoutMs,
      });
      sendWorkerSignal(worker, "SIGTERM");
      record.terminationTimer = setTimer(() => {
        forceKillWorkerAndBoundExit(
          record,
          "ready_timeout",
          "multicore_worker_ready_force_kill",
          { graceMs: settings.readyKillGraceMs }
        );
      }, settings.readyKillGraceMs);
    }, settings.readyTimeoutMs);

    emitLog("info", "multicore_worker_started", {
      workerIndex: slot,
      pid: workerPid(worker),
      backgroundOwner: slot === 0,
    });
    return worker;
  }

  function start() {
    if (started) throw new Error("Cluster supervisor has already been started");
    started = true;
    if (options.registerSignals !== false) {
      processRef.once("SIGTERM", () => beginShutdown("SIGTERM"));
      processRef.once("SIGINT", () => beginShutdown("SIGINT"));
    }
    forkSlot(0);
    return api;
  }

  function snapshot() {
    return {
      started,
      shuttingDown,
      secondaryWorkersStarted,
      workerSlots: Array.from(workersBySlot.keys()).sort((left, right) => left - right),
      readySlots: Array.from(workersBySlot.values())
        .filter((record) => record.ready)
        .map((record) => record.slot)
        .sort((left, right) => left - right),
      restartSlots: Array.from(restartTimers.keys()).sort((left, right) => left - right),
      requestedExitCode,
      exited,
    };
  }

  const api = { beginShutdown, snapshot, start };
  return api;
}

module.exports = {
  DEFAULT_MAX_RESTARTS_PER_WINDOW,
  DEFAULT_READY_TIMEOUT_MS,
  DEFAULT_READY_KILL_GRACE_MS,
  DEFAULT_RESTART_BASE_DELAY_MS,
  DEFAULT_RESTART_MAX_DELAY_MS,
  DEFAULT_RESTART_WINDOW_MS,
  DEFAULT_WORKER_ERROR_EXIT_GRACE_MS,
  createClusterSupervisor,
  resolveSupervisorSettings,
};

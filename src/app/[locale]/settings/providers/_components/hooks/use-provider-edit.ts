import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { editProvider } from "@/actions/providers";
import { PROVIDER_LIMITS } from "@/lib/constants/provider.constants";
import { logger } from "@/lib/logger";
import { clampWeight } from "@/lib/utils/validation";
import type { ProviderDisplay } from "@/types/provider";

export function useProviderEdit(item: ProviderDisplay, canEdit: boolean) {
  const router = useRouter();
  // 基本状态
  const [enabled, setEnabled] = useState<boolean>(item.isEnabled);
  const [togglePending, setTogglePending] = useState(false);

  // 权重编辑
  const [showWeight, setShowWeight] = useState(false);
  const [weight, setWeight] = useState<number>(clampWeight(item.weight));
  const initialWeightRef = useRef<number>(item.weight);

  // 5小时消费上限
  const [show5hLimit, setShow5hLimit] = useState(false);
  const [limit5hInfinite, setLimit5hInfinite] = useState<boolean>(item.limit5hUsd === null);
  const [limit5hValue, setLimit5hValue] = useState<number>(() => {
    return item.limit5hUsd ?? PROVIDER_LIMITS.LIMIT_5H_USD.MIN;
  });
  const initial5hRef = useRef<number | null>(item.limit5hUsd);

  // 周消费上限
  const [showWeeklyLimit, setShowWeeklyLimit] = useState(false);
  const [limitWeeklyInfinite, setLimitWeeklyInfinite] = useState<boolean>(
    item.limitWeeklyUsd === null
  );
  const [limitWeeklyValue, setLimitWeeklyValue] = useState<number>(() => {
    return item.limitWeeklyUsd ?? PROVIDER_LIMITS.LIMIT_WEEKLY_USD.MIN;
  });
  const initialWeeklyRef = useRef<number | null>(item.limitWeeklyUsd);

  // 月消费上限
  const [showMonthlyLimit, setShowMonthlyLimit] = useState(false);
  const [limitMonthlyInfinite, setLimitMonthlyInfinite] = useState<boolean>(
    item.limitMonthlyUsd === null
  );
  const [limitMonthlyValue, setLimitMonthlyValue] = useState<number>(() => {
    return item.limitMonthlyUsd ?? PROVIDER_LIMITS.LIMIT_MONTHLY_USD.MIN;
  });
  const initialMonthlyRef = useRef<number | null>(item.limitMonthlyUsd);

  // 并发Session上限
  const [showConcurrent, setShowConcurrent] = useState(false);
  const [concurrentInfinite, setConcurrentInfinite] = useState<boolean>(
    item.limitConcurrentSessions === 0
  );
  const [concurrentValue, setConcurrentValue] = useState<number>(() => {
    return item.limitConcurrentSessions === 0
      ? PROVIDER_LIMITS.CONCURRENT_SESSIONS.MIN
      : item.limitConcurrentSessions;
  });
  const initialConcurrentRef = useRef<number>(item.limitConcurrentSessions);

  // 切换启用状态
  const handleToggle = async (next: boolean) => {
    if (!canEdit || togglePending) return;
    setTogglePending(true);
    const prev = enabled;
    setEnabled(next);

    try {
      const res = await editProvider(item.id, { is_enabled: next });
      if (!res.ok) {
        throw new Error(res.error);
      }
      // 刷新页面数据以同步所有字段
      router.refresh();
    } catch (e) {
      logger.error("切换服务商启用状态失败", { context: e });
      setEnabled(prev);
      const msg = e instanceof Error ? e.message : "切换失败";
      toast.error(msg);
    } finally {
      setTogglePending(false);
    }
  };

  // 权重编辑处理
  const handleWeightPopover = (open: boolean) => {
    if (!canEdit) return;
    setShowWeight(open);
    if (open) {
      initialWeightRef.current = clampWeight(weight);
      return;
    }

    const next = clampWeight(weight);
    if (next !== clampWeight(initialWeightRef.current)) {
      editProvider(item.id, { weight: next })
        .then((res) => {
          if (!res.ok) throw new Error(res.error);
          // 刷新页面数据以同步所有字段
          router.refresh();
        })
        .catch((e) => {
          logger.error("更新权重失败", { context: e });
          const msg = e instanceof Error ? e.message : "更新权重失败";
          toast.error(msg);
          setWeight(clampWeight(initialWeightRef.current));
        });
    }
  };

  // 5小时消费上限编辑处理
  const handle5hLimitPopover = (open: boolean) => {
    if (!canEdit) return;
    setShow5hLimit(open);
    if (open) {
      initial5hRef.current = item.limit5hUsd;
      return;
    }

    const nextValue = limit5hInfinite
      ? null
      : Math.max(PROVIDER_LIMITS.LIMIT_5H_USD.MIN, limit5hValue);
    if (nextValue !== initial5hRef.current) {
      editProvider(item.id, { limit_5h_usd: nextValue })
        .then((res) => {
          if (!res.ok) throw new Error(res.error);
          // 刷新页面数据以同步所有字段
          router.refresh();
        })
        .catch((e) => {
          logger.error("更新5小时消费上限失败", { context: e });
          const msg = e instanceof Error ? e.message : "更新5小时消费上限失败";
          toast.error(msg);
          setLimit5hInfinite(initial5hRef.current === null);
          setLimit5hValue(initial5hRef.current ?? PROVIDER_LIMITS.LIMIT_5H_USD.MIN);
        });
    }
  };

  // 周消费上限编辑处理
  const handleWeeklyLimitPopover = (open: boolean) => {
    if (!canEdit) return;
    setShowWeeklyLimit(open);
    if (open) {
      initialWeeklyRef.current = item.limitWeeklyUsd;
      return;
    }

    const nextValue = limitWeeklyInfinite
      ? null
      : Math.max(PROVIDER_LIMITS.LIMIT_WEEKLY_USD.MIN, limitWeeklyValue);
    if (nextValue !== initialWeeklyRef.current) {
      editProvider(item.id, { limit_weekly_usd: nextValue })
        .then((res) => {
          if (!res.ok) throw new Error(res.error);
          // 刷新页面数据以同步所有字段
          router.refresh();
        })
        .catch((e) => {
          logger.error("更新周消费上限失败", { context: e });
          const msg = e instanceof Error ? e.message : "更新周消费上限失败";
          toast.error(msg);
          setLimitWeeklyInfinite(initialWeeklyRef.current === null);
          setLimitWeeklyValue(initialWeeklyRef.current ?? PROVIDER_LIMITS.LIMIT_WEEKLY_USD.MIN);
        });
    }
  };

  // 月消费上限编辑处理
  const handleMonthlyLimitPopover = (open: boolean) => {
    if (!canEdit) return;
    setShowMonthlyLimit(open);
    if (open) {
      initialMonthlyRef.current = item.limitMonthlyUsd;
      return;
    }

    const nextValue = limitMonthlyInfinite
      ? null
      : Math.max(PROVIDER_LIMITS.LIMIT_MONTHLY_USD.MIN, limitMonthlyValue);
    if (nextValue !== initialMonthlyRef.current) {
      editProvider(item.id, { limit_monthly_usd: nextValue })
        .then((res) => {
          if (!res.ok) throw new Error(res.error);
          // 刷新页面数据以同步所有字段
          router.refresh();
        })
        .catch((e) => {
          logger.error("更新月消费上限失败", { context: e });
          const msg = e instanceof Error ? e.message : "更新月消费上限失败";
          toast.error(msg);
          setLimitMonthlyInfinite(initialMonthlyRef.current === null);
          setLimitMonthlyValue(initialMonthlyRef.current ?? PROVIDER_LIMITS.LIMIT_MONTHLY_USD.MIN);
        });
    }
  };

  // 并发Session上限编辑处理
  const handleConcurrentPopover = (open: boolean) => {
    if (!canEdit) return;
    setShowConcurrent(open);
    if (open) {
      initialConcurrentRef.current = item.limitConcurrentSessions;
      return;
    }

    const nextValue = concurrentInfinite
      ? 0
      : Math.max(PROVIDER_LIMITS.CONCURRENT_SESSIONS.MIN, concurrentValue);
    if (nextValue !== initialConcurrentRef.current) {
      editProvider(item.id, { limit_concurrent_sessions: nextValue })
        .then((res) => {
          if (!res.ok) throw new Error(res.error);
          // 刷新页面数据以同步所有字段
          router.refresh();
        })
        .catch((e) => {
          logger.error("更新并发Session上限失败", { context: e });
          const msg = e instanceof Error ? e.message : "更新并发Session上限失败";
          toast.error(msg);
          setConcurrentInfinite(initialConcurrentRef.current === 0);
          setConcurrentValue(
            initialConcurrentRef.current === 0
              ? PROVIDER_LIMITS.CONCURRENT_SESSIONS.MIN
              : initialConcurrentRef.current
          );
        });
    }
  };

  return {
    // 状态
    enabled,
    togglePending,
    weight,
    setWeight,
    showWeight,

    // 5小时消费上限
    limit5hInfinite,
    setLimit5hInfinite,
    limit5hValue,
    setLimit5hValue,
    show5hLimit,

    // 周消费上限
    limitWeeklyInfinite,
    setLimitWeeklyInfinite,
    limitWeeklyValue,
    setLimitWeeklyValue,
    showWeeklyLimit,

    // 月消费上限
    limitMonthlyInfinite,
    setLimitMonthlyInfinite,
    limitMonthlyValue,
    setLimitMonthlyValue,
    showMonthlyLimit,

    // 并发Session上限
    concurrentInfinite,
    setConcurrentInfinite,
    concurrentValue,
    setConcurrentValue,
    showConcurrent,

    // 处理函数
    handleToggle,
    handleWeightPopover,
    handle5hLimitPopover,
    handleWeeklyLimitPopover,
    handleMonthlyLimitPopover,
    handleConcurrentPopover,
  };
}

"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Activity,
  Server,
  Zap,
  DollarSign,
  Clock,
  AlertTriangle,
  Globe,
  Moon,
  Sun,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Wifi,
  Layers,
  Shield,
  User,
  PieChart as PieIcon,
} from "lucide-react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import useSWR from "swr";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, usePathname } from "@/i18n/routing";
import { locales, localeLabels, type Locale } from "@/i18n/config";
import { getDashboardRealtimeData } from "@/actions/dashboard-realtime";

/**
 * ============================================================================
 * 配置与常量
 * ============================================================================
 */
const COLORS = {
  models: ["#ff6b35", "#00d4ff", "#ffd60a", "#00ff88", "#a855f7"],
};

const THEMES = {
  dark: {
    bg: "bg-[#0a0a0f]",
    text: "text-[#e6e6e6]",
    card: "bg-[#1a1a2e]/60 backdrop-blur-md border border-white/5",
    accent: "text-[#ff6b35]",
    border: "border-white/5",
  },
  light: {
    bg: "bg-[#fafafa]",
    text: "text-[#1a1a1a]",
    card: "bg-white/80 backdrop-blur-md border border-black/5 shadow-sm",
    accent: "text-[#ff5722]",
    border: "border-black/5",
  },
};

/**
 * ============================================================================
 * 实用组件：粒子背景 (Canvas)
 * ============================================================================
 */
const ParticleBackground = ({ themeMode }: { themeMode: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      alpha: number;
    }> = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", resize);
    resize();

    const createParticles = () => {
      const count = window.innerWidth < 1000 ? 50 : 80;
      particles = [];
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          size: Math.random() * 2 + 0.5,
          alpha: Math.random() * 0.4 + 0.1,
        });
      }
    };
    createParticles();

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const particleColor = themeMode === "dark" ? "255, 107, 53" : "2, 119, 189";

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${particleColor}, ${p.alpha})`;
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(render);
    };
    render();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [themeMode]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute top-0 left-0 w-full h-full pointer-events-none z-0"
    />
  );
};

/**
 * ============================================================================
 * 实用组件：数字滚动动画
 * ============================================================================
 */
const CountUp = ({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  className = "",
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}) => {
  const [displayValue, setDisplayValue] = useState(value);
  useEffect(() => {
    const start = displayValue;
    const end = value;
    if (start === end) return;
    const duration = 1000;
    const startTime = performance.now();
    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 4);
      const current = start + (end - start) * ease;
      setDisplayValue(current);
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [value]);
  return (
    <span className={`font-mono ${className}`}>
      {prefix}
      {displayValue.toFixed(decimals)}
      {suffix}
    </span>
  );
};

/**
 * ============================================================================
 * 核心业务组件
 * ============================================================================
 */

// 1. 顶部核心指标
const MetricCard = ({
  title,
  value,
  subValue,
  icon: Icon,
  type = "neutral",
  theme,
}: {
  title: string;
  value: React.ReactNode;
  subValue?: string;
  icon: React.ComponentType<{ size: number; className?: string }>;
  type?: string;
  theme: (typeof THEMES)[keyof typeof THEMES];
}) => {
  const isPositive = type === "positive";
  const isNegative = type === "negative";
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`relative overflow-hidden rounded-lg p-4 flex flex-col justify-between h-full ${theme.card} hover:border-orange-500/30 transition-colors group`}
    >
      <div className="absolute -top-6 -right-6 w-24 h-24 bg-orange-500/10 rounded-full blur-2xl" />
      <div className="flex justify-between items-start z-10">
        <span className={`text-xs uppercase tracking-wider font-semibold ${theme.text} opacity-50`}>
          {title}
        </span>
        <Icon size={16} className={`${theme.accent} opacity-80`} />
      </div>
      <div className="flex items-end gap-3 mt-1 z-10">
        <div className="relative">
          {type === "pulse" && (
            <span className="absolute -left-2.5 top-1/2 -translate-y-1/2 flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-orange-500"></span>
            </span>
          )}
          <span className={`text-3xl font-bold font-mono tracking-tight ${theme.text}`}>
            {value}
          </span>
        </div>
      </div>
      <div className="mt-1 flex items-center text-[10px] font-medium z-10">
        {subValue && (
          <span
            className={`flex items-center gap-0.5 ${isPositive ? "text-[#00ff88]" : isNegative ? "text-[#ff006e]" : "text-gray-400"}`}
          >
            {isPositive ? <ArrowUp size={10} /> : isNegative ? <ArrowDown size={10} /> : null}
            {subValue}
          </span>
        )}
      </div>
    </motion.div>
  );
};

// 2. 实时活动流
const ActivityStream = ({
  activities,
  theme,
  t,
}: {
  activities: Array<{
    id: string;
    user: string;
    model: string;
    provider: string;
    latency: number;
    status: number;
  }>;
  theme: (typeof THEMES)[keyof typeof THEMES];
  t: (key: string) => string;
}) => {
  return (
    <div className="h-full flex flex-col">
      <div
        className={`text-xs font-bold mb-2 flex items-center gap-2 ${theme.text} uppercase tracking-wider px-1`}
      >
        <Zap size={12} className="text-yellow-400" />
        {t("sections.activity")}
      </div>
      <div className="flex-1 overflow-hidden relative rounded-lg border border-white/5 bg-black/20">
        <div
          className={`grid grid-cols-12 gap-2 text-[10px] font-mono opacity-50 py-2 px-3 border-b border-white/5 ${theme.text}`}
        >
          <div className="col-span-2">{t("headers.user")}</div>
          <div className="col-span-3">{t("headers.model")}</div>
          <div className="col-span-3">{t("headers.provider")}</div>
          <div className="col-span-2 text-right">{t("headers.latency")}</div>
          <div className="col-span-2 text-right">{t("headers.status")}</div>
        </div>

        <div className="space-y-0.5 relative h-full overflow-y-auto no-scrollbar p-1">
          <AnimatePresence initial={false}>
            {activities.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: 20, backgroundColor: "rgba(255, 107, 53, 0.2)" }}
                animate={{ opacity: 1, x: 0, backgroundColor: "rgba(255,255,255,0.02)" }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className={`grid grid-cols-12 gap-2 p-2 rounded text-[10px] font-mono items-center hover:bg-white/10 transition-colors`}
              >
                <div className={`col-span-2 truncate font-bold text-orange-400`}>{item.user}</div>
                <div className={`col-span-3 truncate text-gray-300`}>{item.model}</div>
                <div className={`col-span-3 truncate text-gray-500`}>{item.provider}</div>
                <div
                  className={`col-span-2 text-right ${item.latency > 1000 ? "text-red-400" : "text-green-400"}`}
                >
                  {item.latency}ms
                </div>
                <div className="col-span-2 text-right flex justify-end">
                  <span
                    className={`px-1.5 rounded-sm ${
                      item.status === 200
                        ? "bg-green-500/10 text-green-500"
                        : "bg-red-500/10 text-red-500"
                    }`}
                  >
                    {item.status}
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
      <style jsx>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
};

// 3. 供应商并发插槽
const ProviderQuotas = ({
  providers,
  theme,
  t,
}: {
  providers: Array<{
    name: string;
    usedSlots: number;
    totalSlots: number;
  }>;
  theme: (typeof THEMES)[keyof typeof THEMES];
  t: (key: string) => string;
}) => {
  return (
    <div className="h-full flex flex-col">
      <div
        className={`text-xs font-bold mb-3 flex items-center gap-2 ${theme.text} uppercase tracking-wider`}
      >
        <Server size={12} className="text-blue-400" />
        {t("sections.providerQuotas")}
      </div>
      <div className="flex-1 flex flex-col justify-around gap-2">
        {providers.map((p, idx) => {
          const percent = p.totalSlots > 0 ? (p.usedSlots / p.totalSlots) * 100 : 0;
          const isCritical = percent > 90;
          const isWarning = percent > 70;

          return (
            <div key={idx} className="flex flex-col gap-1">
              <div className="flex justify-between items-end text-[10px]">
                <span className={`font-mono font-bold ${theme.text}`}>{p.name}</span>
                <span className={`font-mono ${isCritical ? "text-red-400" : "text-gray-400"}`}>
                  {p.usedSlots}/{p.totalSlots} Slots
                </span>
              </div>
              <div className="h-2.5 w-full bg-gray-700/30 rounded-sm overflow-hidden relative flex gap-[1px]">
                <div
                  className={`h-full absolute left-0 top-0 transition-all duration-1000 ease-out ${
                    isCritical
                      ? "bg-gradient-to-r from-red-500 to-red-400"
                      : isWarning
                        ? "bg-gradient-to-r from-yellow-500 to-orange-500"
                        : "bg-gradient-to-r from-blue-600 to-cyan-400"
                  }`}
                  style={{ width: `${percent}%` }}
                />
                <div className="absolute inset-0 w-full h-full flex">
                  {Array.from({ length: 20 }).map((_, i) => (
                    <div key={i} className="flex-1 border-r border-black/20 h-full" />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// 4. 用户排行
const UserRankings = ({
  users,
  theme,
  t,
}: {
  users: Array<{
    userId: number;
    userName: string;
    totalCost: number;
    totalRequests: number;
  }>;
  theme: (typeof THEMES)[keyof typeof THEMES];
  t: (key: string) => string;
}) => {
  return (
    <div className="h-full flex flex-col relative">
      <div
        className={`text-xs font-bold mb-3 flex items-center gap-2 ${theme.text} uppercase tracking-wider`}
      >
        <User size={12} className="text-purple-400" />
        {t("sections.userRank")}
        <span className="ml-auto flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-green-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
        </span>
      </div>

      <div className="flex-1 space-y-2 overflow-hidden">
        {users.slice(0, 5).map((user, index) => (
          <motion.div
            key={user.userId}
            layout
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className={`flex items-center gap-3 p-2 rounded border ${
              index === 0
                ? "bg-gradient-to-r from-orange-500/20 to-transparent border-orange-500/30"
                : theme.border + " bg-white/5"
            }`}
          >
            <div
              className={`
              w-6 h-6 rounded flex items-center justify-center text-xs font-bold
              ${
                index === 0
                  ? "bg-[#ff6b35] text-white shadow-lg shadow-orange-500/50"
                  : index === 1
                    ? "bg-gray-400 text-black"
                    : index === 2
                      ? "bg-orange-800 text-white"
                      : "bg-gray-800 text-gray-400"
              }
            `}
            >
              {index + 1}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center">
                <span className={`text-xs font-bold truncate ${theme.text}`}>{user.userName}</span>
                <span className="text-[10px] text-gray-500 font-mono">
                  ${user.totalCost.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center mt-1">
                <div className="w-16 h-1 bg-gray-700 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-purple-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${(user.totalCost / (users[0]?.totalCost || 1)) * 100}%` }}
                  />
                </div>
                <span className="text-[9px] text-gray-500">{user.totalRequests} reqs</span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

// 5. 供应商排行
const ProviderRanking = ({
  providers,
  theme,
  t,
}: {
  providers: Array<{
    providerId: number;
    providerName: string;
    totalCost: number;
    totalTokens: number;
  }>;
  theme: (typeof THEMES)[keyof typeof THEMES];
  t: (key: string) => string;
}) => {
  return (
    <div className="h-full flex flex-col">
      <div
        className={`text-xs font-bold mb-3 flex items-center gap-2 ${theme.text} uppercase tracking-wider`}
      >
        <Shield size={12} className="text-green-400" />
        {t("sections.providerRank")}
      </div>
      <div className="flex-1 space-y-2">
        {providers.map((p, i) => (
          <div
            key={p.providerId}
            className="flex items-center justify-between p-2 rounded bg-white/5 border border-white/5"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 font-mono w-3">0{i + 1}</span>
              <span className={`text-xs font-semibold ${theme.text}`}>{p.providerName}</span>
            </div>
            <div className="text-right">
              <div className={`text-xs font-mono ${theme.accent}`}>${p.totalCost.toFixed(2)}</div>
              <div className="text-[9px] text-gray-500">
                {p.totalTokens.toLocaleString()} Tokens
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// 6. 流量趋势（24小时）
const TrafficTrend = ({
  data,
  theme,
  t,
  currentTime,
}: {
  data: Array<{
    hour: number;
    value: number;
  }>;
  theme: (typeof THEMES)[keyof typeof THEMES];
  t: (key: string) => string;
  currentTime: Date;
}) => {
  // 只显示到当前小时的数据（截断未来时间）
  const currentHour = currentTime.getUTCHours();
  const filteredData = data
    .filter((item) => item.hour <= currentHour)
    .map((item) => ({
      hour: item.hour,
      value: item.value,
      hourLabel: `${item.hour}:00`,
    }));

  return (
    <div className="h-full flex flex-col">
      <div
        className={`text-xs font-bold mb-2 flex items-center gap-2 ${theme.text} uppercase tracking-wider`}
      >
        <Activity size={12} className="text-orange-400" />
        {t("sections.requestTrend")}
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={filteredData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
            <defs>
              <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ff6b35" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#ff6b35" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="hour"
              stroke={theme.text === "text-[#e6e6e6]" ? "#666" : "#999"}
              tick={{ fill: theme.text === "text-[#e6e6e6]" ? "#666" : "#999", fontSize: 10 }}
              tickFormatter={(value) => `${value}h`}
            />
            <YAxis
              stroke={theme.text === "text-[#e6e6e6]" ? "#666" : "#999"}
              tick={{ fill: theme.text === "text-[#e6e6e6]" ? "#666" : "#999", fontSize: 10 }}
              width={30}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0a0a0f",
                borderColor: "#333",
                fontSize: "11px",
                borderRadius: "6px",
              }}
              itemStyle={{ color: "#fff" }}
              labelFormatter={(value) => `${value}:00`}
              formatter={(value: number) => [`${value} 请求`, "数量"]}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#ff6b35"
              fill="url(#grad1)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#ff6b35" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// 7. 模型分布
const ModelDistribution = ({
  data,
  theme,
  t,
}: {
  data: Array<{
    model: string;
    totalRequests: number;
  }>;
  theme: (typeof THEMES)[keyof typeof THEMES];
  t: (key: string) => string;
}) => {
  const chartData = data.map((item) => ({
    name: item.model,
    value: item.totalRequests,
  }));

  // 处理空数据的情况
  if (chartData.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <div
          className={`text-xs font-bold mb-1 flex items-center gap-2 ${theme.text} uppercase tracking-wider`}
        >
          <PieIcon size={12} className="text-indigo-400" />
          {t("sections.modelDist")}
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span className={`text-xs ${theme.text} opacity-50`}>暂无数据</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div
        className={`text-xs font-bold mb-1 flex items-center gap-2 ${theme.text} uppercase tracking-wider`}
      >
        <PieIcon size={12} className="text-indigo-400" />
        {t("sections.modelDist")}
      </div>
      <div className="flex-1 min-h-0 flex items-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              innerRadius={30}
              outerRadius={50}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
            >
              {chartData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS.models[index % COLORS.models.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ backgroundColor: "#0a0a0f", borderColor: "#333", fontSize: "12px" }}
              itemStyle={{ color: "#fff" }}
            />
            <Legend
              layout="vertical"
              verticalAlign="middle"
              align="right"
              iconSize={8}
              wrapperStyle={{ fontSize: "10px", color: "#999" }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

/**
 * ============================================================================
 * 主应用
 * ============================================================================
 */
export default function BigScreenPage() {
  const t = useTranslations("bigScreen");
  const [themeMode, setThemeMode] = useState("dark");
  const [currentTime, setCurrentTime] = useState(new Date());

  // 语言切换
  const currentLocale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();

  const handleLocaleSwitch = () => {
    // 循环切换语言：zh-CN → en → ja → ru → zh-TW → zh-CN
    const currentIndex = locales.indexOf(currentLocale as Locale);
    const nextIndex = (currentIndex + 1) % locales.length;
    const nextLocale = locales[nextIndex];

    router.push(pathname || "/dashboard", { locale: nextLocale });
  };

  const theme = THEMES[themeMode as keyof typeof THEMES];

  // 时钟
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 使用 SWR 获取数据，2秒刷新
  const { data, error, mutate } = useSWR(
    "dashboard-realtime",
    async () => {
      const result = await getDashboardRealtimeData();
      if (!result.ok) {
        throw new Error(result.error || "Failed to fetch data");
      }
      return result.data;
    },
    {
      refreshInterval: 2000, // 2秒刷新
      revalidateOnFocus: false,
    }
  );

  // 处理数据
  const metrics = data?.metrics || {
    concurrentSessions: 0,
    todayRequests: 0,
    todayCost: 0,
    avgResponseTime: 0,
    todayErrorRate: 0,
  };

  const activities = (data?.activityStream || []).map((item) => ({
    id: item.id,
    user: item.user,
    model: item.model,
    provider: item.provider,
    latency: item.latency,
    status: item.status,
  }));

  const users = data?.userRankings || [];
  const providers = data?.providerSlots || [];
  const providerRankings = data?.providerRankings || [];
  const modelDist = data?.modelDistribution || [];
  const trendData = data?.trendData || [];

  return (
    <div
      className={`relative w-full h-screen overflow-hidden transition-colors duration-500 font-sans selection:bg-orange-500/30 ${theme.bg}`}
    >
      <ParticleBackground themeMode={themeMode} />

      <div className="relative z-10 flex flex-col h-full p-4 gap-4 max-w-[1920px] mx-auto">
        {/* Header */}
        <header className="flex justify-between items-center pb-2 border-b border-white/5">
          <div className="flex flex-col">
            <h1 className={`text-2xl font-bold tracking-widest font-space ${theme.text}`}>
              {t("title")}
            </h1>
            <p className={`text-[10px] tracking-[0.5em] uppercase opacity-50 ${theme.text} mt-1`}>
              {t("subtitle")}
            </p>
          </div>

          <div className="flex items-center gap-6">
            <div className={`text-right hidden md:block ${theme.text}`}>
              <div className="text-xl font-mono font-bold tabular-nums">
                {currentTime.toLocaleTimeString()}
              </div>
            </div>
            <div className="h-6 w-[1px] bg-white/10" />
            <div className="flex gap-2">
              <button
                onClick={handleLocaleSwitch}
                className={`p-1.5 rounded hover:bg-white/5 ${theme.text} flex items-center gap-1.5 transition-colors`}
                title={`当前: ${localeLabels[currentLocale]} (点击切��)`}
              >
                <Globe size={18} />
                <span className="text-[10px] font-mono uppercase">
                  {currentLocale.split("-")[0]}
                </span>
              </button>
              <button
                onClick={() => setThemeMode(themeMode === "dark" ? "light" : "dark")}
                className={`p-1.5 rounded hover:bg-white/5 ${theme.text} transition-colors`}
              >
                {themeMode === "dark" ? <Moon size={18} /> : <Sun size={18} />}
              </button>
              <button
                onClick={() => mutate()}
                className={`p-1.5 rounded hover:bg-white/5 ${theme.text} transition-colors`}
              >
                <RefreshCw size={18} />
              </button>
            </div>
          </div>
        </header>

        {/* Top Metrics Row */}
        <div className="grid grid-cols-5 gap-3 h-[120px]">
          <MetricCard
            title={t("metrics.concurrent")}
            value={metrics.concurrentSessions}
            subValue={`${activities.length} Recent`}
            type="pulse"
            icon={Wifi}
            theme={theme}
          />
          <MetricCard
            title={t("metrics.requests")}
            value={<CountUp value={metrics.todayRequests} />}
            subValue="Today"
            type="positive"
            icon={Activity}
            theme={theme}
          />
          <MetricCard
            title={t("metrics.cost")}
            value={<CountUp value={metrics.todayCost} prefix="$" decimals={2} />}
            subValue="Budget"
            type="neutral"
            icon={DollarSign}
            theme={theme}
          />
          <MetricCard
            title={t("metrics.latency")}
            value={`${metrics.avgResponseTime}ms`}
            subValue="Avg"
            type="positive"
            icon={Clock}
            theme={theme}
          />
          <MetricCard
            title={t("metrics.errorRate")}
            value={`${metrics.todayErrorRate.toFixed(2)}%`}
            subValue={metrics.todayErrorRate > 2 ? "High" : "Normal"}
            type={metrics.todayErrorRate > 2 ? "negative" : "neutral"}
            icon={AlertTriangle}
            theme={theme}
          />
        </div>

        {/* Main Content Grid */}
        <div className="flex-1 grid grid-cols-12 gap-4 min-h-0">
          {/* LEFT COL */}
          <div className="col-span-3 flex flex-col gap-4 h-full">
            <div className={`flex-[3] ${theme.card} rounded-lg p-4 overflow-hidden`}>
              <UserRankings users={users} theme={theme} t={t} />
            </div>
            <div className={`flex-[2] ${theme.card} rounded-lg p-4 overflow-hidden`}>
              <ProviderRanking providers={providerRankings} theme={theme} t={t} />
            </div>
          </div>

          {/* MIDDLE COL */}
          <div className="col-span-5 flex flex-col gap-4 h-full">
            <div className={`flex-[2] ${theme.card} rounded-lg p-4`}>
              <ProviderQuotas providers={providers} theme={theme} t={t} />
            </div>
            <div className={`flex-[2] ${theme.card} rounded-lg p-4`}>
              <TrafficTrend data={trendData} theme={theme} t={t} currentTime={currentTime} />
            </div>
            <div className={`flex-[1] ${theme.card} rounded-lg p-4`}>
              <ModelDistribution data={modelDist} theme={theme} t={t} />
            </div>
          </div>

          {/* RIGHT COL */}
          <div className="col-span-4 h-full">
            <div className={`h-full ${theme.card} rounded-lg p-0 overflow-hidden flex flex-col`}>
              <div className="p-3 pb-0">
                <ActivityStream activities={activities} theme={theme} t={t} />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer
          className={`h-6 flex items-center justify-between text-[9px] uppercase tracking-wider opacity-40 ${theme.text}`}
        >
          <span>{t("status.normal")}</span>
          <span>
            {t("status.lastUpdate")}: {error ? "Error" : "2s ago"}
          </span>
        </footer>
      </div>

      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@400;600;700&display=swap");
        .font-mono {
          font-family: "JetBrains Mono", monospace;
        }
        .font-space {
          font-family: "Space Grotesk", sans-serif;
        }
      `}</style>
    </div>
  );
}

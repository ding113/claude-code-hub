import { cn } from "@/lib/utils";

interface CircularProgressProps {
  /** 当前值 */
  value: number;
  /** 最大值 */
  max: number;
  /** 尺寸（像素） */
  size?: number;
  /** 线条粗细 */
  strokeWidth?: number;
  /** 显示文本（默认显示百分比） */
  label?: string;
  /** 是否显示百分比数字 */
  showPercentage?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * 圆形进度条组件
 * 根据使用率自动显示不同颜色：
 * - 绿色：< 70%
 * - 黄色：70% - 90%
 * - 红色：> 90%
 */
export function CircularProgress({
  value,
  max,
  size = 48,
  strokeWidth = 4,
  label,
  showPercentage = true,
  className,
}: CircularProgressProps) {
  // 计算百分比
  const percentage = max > 0 ? Math.min(Math.round((value / max) * 100), 100) : 0;

  // 根据百分比确定颜色
  const getColor = () => {
    if (percentage >= 90) return "text-red-500";
    if (percentage >= 70) return "text-yellow-500";
    return "text-green-500";
  };

  // SVG 圆形参数
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* 背景圆环 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="none"
          className="text-muted/30"
        />
        {/* 进度圆环 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn("transition-all duration-500 ease-in-out", getColor())}
        />
      </svg>

      {/* 中心文本 */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {showPercentage && (
          <span className={cn("text-xs font-semibold", getColor())}>{percentage}%</span>
        )}
        {label && <span className="text-[10px] text-muted-foreground">{label}</span>}
      </div>
    </div>
  );
}

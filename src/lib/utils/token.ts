const TOKEN_UNIT_K = 1000;
const TOKEN_UNIT_M = TOKEN_UNIT_K * TOKEN_UNIT_K;

const NUMBER_FORMAT_OPTIONS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
};

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, NUMBER_FORMAT_OPTIONS);
}

function appendUnit(value: number, divisor: number, unit: string): string {
  const scaled = value / divisor;
  return `${formatNumber(scaled)}${unit}`;
}

/**
 * 统一的 Token 数值格式化函数
 * - 小于 1000 显示原值
 * - 小于 1000 * 1000 时转为 K，保留2位小数
 * - 其他情况转为 M，保留2位小数
 * - 空值返回 "-"
 */
export function formatTokenAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }

  const absolute = Math.abs(value);

  if (absolute < TOKEN_UNIT_K) {
    return formatNumber(value);
  }

  if (absolute < TOKEN_UNIT_M) {
    return appendUnit(value, TOKEN_UNIT_K, "K");
  }

  return appendUnit(value, TOKEN_UNIT_M, "M");
}

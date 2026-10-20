// Presentation only: never use this filter to validate requests or rewrite saved model IDs.
const CURRENT_MINIMAX_TEXT_MODELS = new Map([
  ["minimax-m3.1-flash", 0],
  ["minimax/minimax-m3.1-flash:free", 0],
  ["minimax-m3.1-flash-free", 0],
  ["minimax-m3", 1],
  ["minimax/minimax-m3", 1],
]);

// Match published text-model names, leaving custom aliases and media models alone.
const MINIMAX_TEXT_MODEL =
  /^(?:minimax\/)?(?:minimax-m\d+(?:\.\d+)?(?:-(?:highspeed|lightning|preview|flash|flash-free))?(?::free)?|minimax-text-01|abab\d+(?:\.\d+)?-chat)$/i;

export const MINIMAX_TEXT_DEFAULTS = ["MiniMax-M3.1-Flash", "MiniMax-M3"] as const;

export function isDirectMinimaxUrl(value: string | undefined): boolean {
  try {
    const url = new URL(value ?? "");
    return (
      url.protocol === "https:" && ["api.minimax.io", "api.minimaxi.com"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function compareMinimaxModelPriority(left: string, right: string): number {
  return (
    (CURRENT_MINIMAX_TEXT_MODELS.get(left.toLowerCase()) ?? 2) -
    (CURRENT_MINIMAX_TEXT_MODELS.get(right.toLowerCase()) ?? 2)
  );
}

/** Keep advertised current routes, with Flash first; never invent gateway model IDs. */
export function currentMinimaxModelOptions<T>(items: T[], modelName: (item: T) => string): T[] {
  return items
    .filter((item) => {
      const name = modelName(item);
      return !MINIMAX_TEXT_MODEL.test(name) || CURRENT_MINIMAX_TEXT_MODELS.has(name.toLowerCase());
    })
    .sort((left, right) => compareMinimaxModelPriority(modelName(left), modelName(right)));
}

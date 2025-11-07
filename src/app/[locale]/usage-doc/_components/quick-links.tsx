"use client";

interface QuickLinksProps {
  isLoggedIn: boolean;
  onBackToTop?: () => void;
}

/**
 * 快速链接组件
 * 支持桌面端和移动端复用
 */
export function QuickLinks({ isLoggedIn, onBackToTop }: QuickLinksProps) {
  const handleBackToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    onBackToTop?.();
  };

  return (
    <div className="space-y-2">
      {isLoggedIn && (
        <a
          href="/dashboard"
          className="block text-sm text-muted-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded px-2 py-1"
        >
          返回仪表盘
        </a>
      )}
      <button
        onClick={handleBackToTop}
        className="block w-full text-left text-sm text-muted-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded px-2 py-1"
      >
        回到顶部
      </button>
    </div>
  );
}

"use client";

/**
 * 全局错误边界组件
 *
 * 必须是 Client Component，且包含 html 和 body 标签
 * 当 root layout 抛出错误时显示
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            fontFamily: "system-ui, sans-serif",
            backgroundColor: "#f8f9fa",
            padding: "20px",
          }}
        >
          <h2 style={{ fontSize: "24px", marginBottom: "16px", color: "#dc3545" }}>
            Something went wrong!
          </h2>
          <p style={{ color: "#6c757d", marginBottom: "24px" }}>
            {error.message || "An unexpected error occurred"}
          </p>
          {error.digest && (
            <p style={{ fontSize: "12px", color: "#adb5bd", marginBottom: "16px" }}>
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={() => reset()}
            style={{
              padding: "12px 24px",
              fontSize: "16px",
              backgroundColor: "#0d6efd",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

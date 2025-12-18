"use client";

import { isNetworkError } from "@/lib/utils/error-detection";

/**
 * Global error boundary component
 *
 * Must be a Client Component with html and body tags
 * Displayed when root layout throws an error
 *
 * Note: Most errors should be caught by component-level error boundaries
 * or try-catch in event handlers. This is the last resort fallback.
 *
 * Security: Never display raw error.message to users as it may contain
 * sensitive information (database strings, file paths, internal APIs, etc.)
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Use shared network error detection
  const isNetwork = isNetworkError(error);

  const handleGoHome = () => {
    window.location.href = "/";
  };

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
            textAlign: "center",
          }}
        >
          <h2
            style={{
              fontSize: "24px",
              marginBottom: "16px",
              color: isNetwork ? "#f59e0b" : "#dc3545",
            }}
          >
            {isNetwork ? "Network Connection Error" : "Something went wrong!"}
          </h2>

          {isNetwork ? (
            <div style={{ color: "#6c757d", marginBottom: "24px", maxWidth: "400px" }}>
              <p style={{ marginBottom: "12px" }}>Unable to connect to the server. Please check:</p>
              <ul
                style={{
                  textAlign: "left",
                  margin: "0 auto",
                  paddingLeft: "20px",
                  listStyleType: "disc",
                }}
              >
                <li>Your network connection is working</li>
                <li>The server is running and accessible</li>
                <li>Proxy settings are configured correctly</li>
              </ul>
            </div>
          ) : (
            <p style={{ color: "#6c757d", marginBottom: "24px", maxWidth: "400px" }}>
              An unexpected error occurred. Please try again later.
            </p>
          )}

          {error.digest && (
            <p style={{ fontSize: "12px", color: "#adb5bd", marginBottom: "16px" }}>
              Error ID: {error.digest}
            </p>
          )}

          <div style={{ display: "flex", gap: "12px" }}>
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
            <button
              onClick={handleGoHome}
              style={{
                padding: "12px 24px",
                fontSize: "16px",
                backgroundColor: "#6c757d",
                color: "white",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              Go to Home
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}

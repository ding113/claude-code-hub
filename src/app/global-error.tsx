"use client";

import "./globals.css";

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
        <div className="global-error-shell">
          <h2 className={isNetwork ? "global-error-title network" : "global-error-title"}>
            {isNetwork ? "Network Connection Error" : "Something went wrong!"}
          </h2>

          {isNetwork ? (
            <div className="global-error-copy">
              <p className="global-error-check-title">
                Unable to connect to the server. Please check:
              </p>
              <ul className="global-error-check-list">
                <li>Your network connection is working</li>
                <li>The server is running and accessible</li>
                <li>Proxy settings are configured correctly</li>
              </ul>
            </div>
          ) : (
            <p className="global-error-copy">
              An unexpected error occurred. Please try again later.
            </p>
          )}

          {error.digest && <p className="global-error-digest">Error ID: {error.digest}</p>}

          <div className="global-error-actions">
            <button type="button" onClick={() => reset()} className="global-error-button primary">
              Try again
            </button>
            <button type="button" onClick={handleGoHome} className="global-error-button">
              Go to Home
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}

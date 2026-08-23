"use client";

import { useEffect } from "react";

export default function GlobalRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#141b1a",
          color: "#e8efec",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "24px",
        }}
      >
        <section
          aria-labelledby="global-error-title"
          style={{
            maxWidth: "560px",
            width: "100%",
            padding: "30px",
            border: "1px solid #2c3836",
            background: "#182020",
          }}
        >
          <p
            style={{
              margin: 0,
              color: "#ffd69a",
              fontSize: "10px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            WrapForge
          </p>
          <h2
            id="global-error-title"
            style={{
              fontSize: "clamp(28px, 5vw, 44px)",
              margin: "12px 0 18px",
            }}
          >
            WrapForge is temporarily unavailable.
          </h2>
          <p style={{ margin: 0, color: "#9fb3ad", lineHeight: 1.6 }}>
            An unexpected error interrupted the application shell. Retry now; if
            it keeps failing, come back shortly.
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "14px",
              marginTop: "20px",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                padding: "10px 18px",
                border: "1px solid #2c3836",
                background: "#e8efec",
                color: "#141b1a",
                font: "inherit",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Retry
            </button>
            {/* global-error renders when the router runtime is broken; a
              plain anchor must not depend on next/link internals. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                color: "#ffd69a",
                textDecoration: "underline",
                alignSelf: "center",
              }}
            >
              Return to Homepage
            </a>
          </div>
        </section>
      </body>
    </html>
  );
}

"use client";

import {
  Analytics,
  type BeforeSend as AnalyticsBeforeSend,
} from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

function redactUrl(url: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (
      segments.length >= 2 &&
      (segments[0] === "u" || segments[0] === "wrap")
    ) {
      parsed.pathname = `/${segments[0]}/[id]`;
    }
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "/[redacted]";
  }
}

const beforeSend: AnalyticsBeforeSend = (event) => ({
  ...event,
  url: redactUrl(event.url),
});

export function Observability() {
  const pathname = usePathname();
  useEffect(() => {
    void fetch("/api/observability/page-view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      keepalive: true,
    }).catch(() => undefined);
  }, [pathname]);
  return (
    <>
      <Analytics beforeSend={beforeSend} />
      <SpeedInsights
        beforeSend={(event) => ({ ...event, url: redactUrl(event.url) })}
      />
    </>
  );
}

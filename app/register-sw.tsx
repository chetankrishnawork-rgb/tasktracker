"use client";

import { useEffect } from "react";

export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support is a progressive enhancement; a failed registration
      // (e.g. unsupported browser, dev environment) should never block the app.
    });
  }, []);

  return null;
}

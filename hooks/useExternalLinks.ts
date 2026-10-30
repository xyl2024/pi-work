"use client";

import { useEffect } from "react";
import { resolveNewTabUrl } from "@/lib/shared/external-link";

export function useExternalLinks(): void {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      const anchor = target instanceof Element ? target.closest("a[href]") : null;
      if (!anchor) return;

      const url = resolveNewTabUrl({
        href: anchor.getAttribute("href"),
        target: anchor.getAttribute("target"),
        download: anchor.hasAttribute("download"),
        baseUrl: window.location.href,
      });
      if (!url) return;

      event.preventDefault();
      window.open(url, "_blank", "noopener,noreferrer");
    };

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
    };
  }, []);
}

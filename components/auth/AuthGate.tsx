"use client";

import { useEffect, useState } from "react";
import { LoginForm } from "./LoginForm";

// Auth gate for the main app page. Checks the session cookie via
// /api/auth/session/status before mounting the (expensive) app shell:
//   - still checking → small centered spinner
//   - unauthenticated → the login form
//   - authenticated → children (AppShell etc.)
// The proxy.ts gateway independently blocks API/page access, so this is
// primarily a UX layer that avoids flashing the app before the 401 lands.
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "login" | "authed">("checking");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session/status")
      .then((res) => res.json() as Promise<{ authenticated?: boolean }>)
      .then((data) => { if (!cancelled) setState(data.authenticated ? "authed" : "login"); })
      .catch(() => { if (!cancelled) setState("login"); });
    return () => { cancelled = true; };
  }, []);

  if (state === "checking") {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            border: "2px solid var(--border)",
            borderTopColor: "var(--accent)",
            animation: "pi-auth-spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes pi-auth-spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (state === "login") {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <LoginForm />
      </div>
    );
  }

  return <>{children}</>;
}

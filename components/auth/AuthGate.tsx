"use client";

import { useEffect, useState } from "react";
import { LoginForm } from "./LoginForm";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "login" | "authed">("checking");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session/status")
      .then((res) => res.json() as Promise<{ authenticated?: boolean; desktop?: boolean }>)
      .then((data) => {
        if (!cancelled) setState(data.authenticated || data.desktop ? "authed" : "login");
      })
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
    return <LoginForm />;
  }

  return <>{children}</>;
}

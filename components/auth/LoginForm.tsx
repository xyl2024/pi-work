"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

// Minimal username/password login form shown by AuthGate (and /login) when
// no valid session cookie exists. Calls POST /api/auth/session/login and
// lets the caller react on success (usually a full reload so the app
// re-renders behind the now-valid cookie).

interface StatusResponse {
  authenticated?: boolean;
  usingDefaultCredentials?: boolean;
  username?: string;
}

export function LoginForm() {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [defaultHint, setDefaultHint] = useState<string | null>(null);

  useEffect(() => {
    // The status endpoint returns whether the built-in admin/admin pair is
    // active so we can show a hint on a fresh deployment.
    let cancelled = false;
    fetch("/api/auth/session/status")
      .then((res) => (res.ok ? (res.json() as Promise<StatusResponse>) : null))
      .then((data) => {
        if (!cancelled && data?.usingDefaultCredentials) {
          setDefaultHint(data.username ?? "admin");
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!username || !password) {
      setError(t("Username and password are required"));
      return;
    }
    setError(null);
    setSubmitting(true);
    fetch("/api/auth/session/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    })
      .then(async (res) => {
        if (res.ok) {
          // Full navigation: every provider/store re-initializes behind the
          // fresh cookie.
          window.location.replace("/");
          return;
        }
        setError(res.status === 401 ? t("Invalid username or password") : t("Login failed"));
      })
      .catch(() => setError(t("Login failed")))
      .finally(() => setSubmitting(false));
  }

  return (
    <form
      onSubmit={submitLogin}
      style={{
        width: 300,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 24,
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--bg-panel, var(--bg))",
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", textAlign: "center" }}>
        Pi Work
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
        {t("Username")}
        <input
          type="text"
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{ ...inputStyle, color: "var(--text)" } as React.CSSProperties}
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
        {t("Password")}
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ ...inputStyle, color: "var(--text)" } as React.CSSProperties}
        />
      </label>
      {error && (
        <div style={{ fontSize: 12, color: "#ef4444" }}>{error}</div>
      )}
      <button
        type="submit"
        disabled={submitting}
        style={{
          padding: "8px 0",
          borderRadius: 8,
          border: "none",
          background: submitting ? "var(--accent, #2563eb)" : "var(--accent, #2563eb)",
          color: "#fff",
          fontWeight: 600,
          fontSize: 13,
          cursor: submitting ? "default" : "pointer",
          opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting ? t("Signing in...") : t("Sign in")}
      </button>
      {defaultHint && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {t("Default credentials hint (username)", { username: defaultHint })}
        </div>
      )}
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  fontSize: 13,
  outline: "none",
};

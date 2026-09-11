"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { MorphToggleIcon } from "@/components/ui/MorphToggleIcon";
import { SUN, MOON } from "@/lib/client/icon-paths";

// ---------------------------------------------------------------------------
// Pi Work sign-in — minimal.
//
// A single quiet column centred in the viewport: brand mark, two fields, one
// button. No illustration, no decoration; the theme CSS variables do the
// theming and the whitespace does the hierarchy.
//
// Contract unchanged: POST /api/auth/session/login, then a full navigation to
// "/" so every provider/store re-initializes behind the fresh cookie.
// ---------------------------------------------------------------------------

interface StatusResponse {
  authenticated?: boolean;
  usingDefaultCredentials?: boolean;
  username?: string;
}

export function LoginForm() {
  const { t } = useI18n();
  const { isDark, setPreset } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [defaultHint, setDefaultHint] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // The status endpoint reports whether the built-in admin/admin pair is
    // active, so a fresh deployment can show a hint.
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

  useEffect(() => {
    // autoFocus is desktop-only: on touch devices it would pop the keyboard
    // before the user has oriented themselves.
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (finePointer) usernameRef.current?.focus();
  }, []);

  // Same theme flip as ProfileBlock: pass the button's coords so the global
  // startViewTransition clip-path radiates from the click.
  const handleToggleTheme = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPreset(isDark ? "light" : "dark", {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  };

  function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!username || !password) {
      setError(t("Username and password are required"));
      usernameRef.current?.focus();
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
          // Full navigation so every store re-initializes behind the cookie.
          window.location.replace("/");
          return;
        }
        setError(res.status === 401 ? t("Invalid username or password") : t("Login failed"));
      })
      .catch(() => setError(t("Login failed")))
      .finally(() => setSubmitting(false));
  }

  const errorId = "pi-login-error";
  const errorProps = error
    ? { "aria-invalid": true as const, "aria-describedby": errorId }
    : {};

  return (
    <div
      className="pi-login relative flex min-h-dvh w-full items-center justify-center overflow-hidden"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <a
        href="#pi-login-form"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:px-3 focus:py-2 focus:text-[13px]"
        style={{ background: "var(--accent)", color: "#fff" }}
      >
        {t("Skip to content")}
      </a>

      <div className="pi-login-glow pi-login-glow-one" aria-hidden="true" />
      <div className="pi-login-glow pi-login-glow-two" aria-hidden="true" />
      <form
        id="pi-login-form"
        onSubmit={submitLogin}
        aria-busy={submitting}
        className="pi-login-shell pi-login-card relative w-full max-w-[390px]"
      >
        <div className="mb-9 text-center">
          <div className="pi-login-mark mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl text-xl font-semibold text-white" aria-hidden="true">π</div>
          <span translate="no" className="block text-[15px] font-semibold tracking-[-0.02em]">Pi Work</span>
          <h1 className="mt-2 text-[25px] font-semibold tracking-[-0.04em]">{t("Welcome back")}</h1>
        </div>

        <div className="flex flex-col gap-4">
          <Field label={t("Username")} htmlFor="pi-login-username">
            <input
              ref={usernameRef}
              id="pi-login-username"
              name="username"
              type="text"
              autoComplete="username"
              spellCheck={false}
              autoCapitalize="none"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="pi-login-input"
              style={{ color: "var(--text)" }}
              {...errorProps}
            />
          </Field>

          <Field
            label={t("Password")}
            htmlFor="pi-login-password"
            trailing={
              <button
                type="button"
                aria-label={showPassword ? t("Hide password") : t("Show password")}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
                className="pi-login-toggle -mr-1 grid h-7 w-7 place-items-center rounded-md"
                style={{ color: "var(--text-dim)" }}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            }
          >
            <input
              id="pi-login-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pi-login-input"
              style={{ color: "var(--text)" }}
              {...errorProps}
            />
          </Field>
        </div>

        {error && (
          <p
            id={errorId}
            role="alert"
            className="mt-4 text-[12.5px] leading-snug"
            style={{ color: "var(--error)" }}
          >
            {error}
          </p>
        )}

        <div className="mt-7 flex items-center gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="pi-login-submit h-10 min-w-0 flex-1 rounded-md text-[13px] font-medium text-white"
          >
            {submitting ? t("Signing in…") : t("Sign in")}
          </button>
          <button
            type="button"
            onClick={handleToggleTheme}
            aria-label={t("Switch theme")}
            aria-pressed={isDark}
            className="pi-login-theme grid h-10 w-10 shrink-0 place-items-center rounded-md"
          >
            <MorphToggleIcon from={SUN} to={MOON} active={isDark} size={16} strokeWidth={2} />
          </button>
        </div>

        {defaultHint && (
          <p className="mt-4 text-[11.5px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
            {t("Default credentials hint (username)", { username: defaultHint })}
          </p>
        )}
      </form>

      <LoginStyles />
    </div>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.15 4.19M6.6 6.6A17.6 17.6 0 0 0 2 11s3.5 7 10 7a9.1 9.1 0 0 0 4.4-1.07" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

function Field({
  label,
  htmlFor,
  trailing,
  children,
}: {
  label: string;
  htmlFor: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-[12px]"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </label>
      <span className="pi-login-field flex h-10 items-center rounded-md px-3">
        <span className="min-w-0 flex-1">{children}</span>
        {trailing}
      </span>
    </div>
  );
}

function LoginStyles() {
  return (
    <style>{`
      .pi-login-shell {
        padding:
          calc(2.5rem + env(safe-area-inset-top))
          calc(1.5rem + env(safe-area-inset-right))
          calc(2.5rem + env(safe-area-inset-bottom))
          calc(1.5rem + env(safe-area-inset-left));
      }

      .pi-login-card {
        background: color-mix(in srgb, var(--bg) 82%, transparent);
        border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
        border-radius: 1.25rem;
        box-shadow: 0 24px 80px color-mix(in srgb, var(--text) 10%, transparent);
        backdrop-filter: blur(18px);
      }
      .pi-login-glow { position: absolute; width: 28rem; height: 28rem; border-radius: 999px; filter: blur(70px); opacity: .16; pointer-events: none; }
      .pi-login-glow-one { background: var(--accent); top: -12rem; left: -8rem; }
      .pi-login-glow-two { background: #8b5cf6; right: -10rem; bottom: -14rem; }
      .pi-login-mark { background: linear-gradient(135deg, var(--accent), #8b5cf6); box-shadow: 0 10px 28px color-mix(in srgb, var(--accent) 30%, transparent); }

      .pi-login-input {
        width: 100%;
        height: 100%;
        background: transparent;
        border: none;
        outline: none;
        font-size: 13.5px;
      }
      /* the visible focus ring lives on .pi-login-field:focus-within */
      .pi-login-input:-webkit-autofill {
        -webkit-text-fill-color: var(--text);
        transition: background-color 9999s;
      }

      .pi-login-field {
        background: transparent;
        border: 1px solid var(--border);
        transition: border-color .12s ease;
      }
      .pi-login-field:focus-within { border-color: var(--accent); }

      .pi-login-theme {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border-radius: 7px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        transition: color .12s ease, background-color .12s ease;
      }
      .pi-login-theme:hover { color: var(--text); background: var(--bg-hover); }
      .pi-login-theme-inline { bottom: calc(2.5rem + env(safe-area-inset-bottom)); }
      .pi-login-theme:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }

      .pi-login-toggle { transition: color .12s ease; }
      .pi-login-toggle:hover { color: var(--text); }
      .pi-login-toggle:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }

      .pi-login-submit {
        background: linear-gradient(135deg, var(--accent), var(--accent-hover));
        box-shadow: 0 8px 20px color-mix(in srgb, var(--accent) 25%, transparent);
        transition: filter .12s ease, opacity .12s ease, box-shadow .12s ease;
      }
      .pi-login-submit:hover:not(:disabled) {
        filter: brightness(1.08);
        box-shadow: 0 10px 24px color-mix(in srgb, var(--accent) 32%, transparent);
      }
      .pi-login-submit:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }
      .pi-login-submit:disabled { cursor: default; opacity: .7; }

      @media (prefers-reduced-motion: reduce) {
        .pi-login-field, .pi-login-toggle, .pi-login-submit, .pi-login-theme { transition: none; }
      }
    `}</style>
  );
}

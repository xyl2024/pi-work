"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "../../ui/Toast";
import { copyText } from "@/lib/client/clipboard";
import type { OAuthLoginState, OAuthProvider } from "./types";
import { SectionTitle } from "./form-fields";
import { oauthDeviceCodeCopyText } from "@/lib/client/oauth-login";
import styles from "./OAuthDetail.module.css";
import {
  bindOAuthLoginSuccess,
  cancelOAuthLogin,
  logoutOAuthProvider,
  resetSettledOAuthLogin,
  startOAuthLogin,
  submitOAuthLoginCode,
} from "@/lib/client/oauth-login-store";
import { isOAuthLoginWorking } from "@/lib/client/oauth-login";

export function OAuthDetail({ provider, loginState, onRefresh }: {
  provider: OAuthProvider;
  loginState: OAuthLoginState;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loginState.phase === "auth" || loginState.phase === "prompt") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loginState.phase]);

  const handleLoginSuccess = useCallback(() => {
    onRefresh();
    toast.show({ kind: "success", message: t("Connected") });
  }, [onRefresh, t, toast]);

  useEffect(() => {
    bindOAuthLoginSuccess(provider.id, handleLoginSuccess);
  }, [provider.id, handleLoginSuccess]);

  useEffect(() => {
    resetSettledOAuthLogin(provider.id);
  }, [provider.id]);

  const handleLogin = useCallback(() => {
    setInputValue("");
    startOAuthLogin(provider.id);
  }, [provider.id]);

  const handleLogout = useCallback(() => {
    void logoutOAuthProvider(provider.id).then(onRefresh);
  }, [provider.id, onRefresh]);

  const submitCode = useCallback(async (code: string) => {
    if (!code.trim()) return;
    const ok = await submitOAuthLoginCode(provider.id, code, t("Verifying…"));
    if (ok) setInputValue("");
  }, [provider.id, t]);

  const submitSelection = useCallback(async (value: string) => {
    await submitOAuthLoginCode(provider.id, value, t("Continuing…"));
  }, [provider.id, t]);

  const copyDeviceCode = useCallback(() => {
    const code = oauthDeviceCodeCopyText(loginState);
    if (!code) return;
    void copyText(code)
      .then(() => toast.show({ kind: "success", message: t("Code copied") }))
      .catch(() => toast.show({ kind: "error", message: t("Copy failed") }));
  }, [loginState, t, toast]);

  const isWorking = isOAuthLoginWorking(loginState);
  const canSubmit = inputValue.trim() !== "";

  return (
    <div className={styles.detail}>
      <div className={styles.header}>
        <SectionTitle>{t("Subscription")}</SectionTitle>
        <div className={styles.status} data-connected={provider.loggedIn ? "true" : undefined}>
          <span className={styles.statusDot} />
          <span className={styles.statusText}>
            {provider.loggedIn ? t("Connected") : t("Not connected")}
          </span>
        </div>
      </div>

      <div className={styles.body}>
        {loginState.phase === "idle" && (
          <p className={styles.text}>
            {provider.loggedIn
              ? t("Already connected. You can re-login or disconnect.")
              : t("Connect your {name} account.", { name: provider.name })}
          </p>
        )}
        {loginState.phase === "connecting" && (
          <p className={styles.text}>{t("Opening browser...")}</p>
        )}
        {loginState.phase === "select" && (
          <div className={styles.group}>
            <p className={styles.text}>{loginState.message}</p>
            <div className={styles.options}>
              {loginState.options.map((option) => (
                <button key={option.id} type="button" className={styles.option} onClick={() => submitSelection(option.id)}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {(loginState.phase === "auth" || loginState.phase === "prompt") && (
          <div className={styles.group}>
            <p className={styles.text}>
              {loginState.phase === "auth"
                ? t("Complete sign-in in the browser, then copy the redirect URL from the address bar and paste it below.")
                : loginState.message}
            </p>
            {loginState.phase === "auth" && (
              <p className={styles.note}>
                {t("Browser window did not open?")}{" "}
                <a href={loginState.url} target="_blank" rel="noopener noreferrer" className={styles.link}>
                  {t("Open the login page")}
                </a>
              </p>
            )}
            <div className={styles.inputRow}>
              <input
                ref={inputRef}
                name="oauth-response"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                autoCapitalize="none"
                spellCheck={false}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitCode(inputValue); }}
                placeholder={loginState.phase === "auth" ? "http://localhost:1455/auth/callback?code=…" : (loginState.placeholder ?? t("Enter value…"))}
                className={styles.input}
              />
              <button
                type="button"
                className={styles.submit}
                data-ready={canSubmit ? "true" : undefined}
                onClick={() => submitCode(inputValue)}
                disabled={!canSubmit}
              >
                {t("Submit")}
              </button>
            </div>
          </div>
        )}
        {loginState.phase === "device_code" && (
          <div className={styles.group}>
            <p className={styles.text}>{t("Open the verification page and enter this code:")}</p>
            <div className={styles.deviceCode}>
              <span className={styles.deviceCodeValue}>{loginState.userCode}</span>
              <button type="button" className={styles.copyButton} onClick={copyDeviceCode}>
                {t("Copy code")}
              </button>
            </div>
            <p className={styles.note}>
              <a href={loginState.verificationUri} target="_blank" rel="noopener noreferrer" className={styles.link}>
                {loginState.verificationUri}
              </a>
              {loginState.expiresInSeconds
                ? ` ${t("Expires in {n} minutes.", { n: Math.ceil(loginState.expiresInSeconds / 60) })}`
                : ""}
            </p>
          </div>
        )}
        {loginState.phase === "progress" && (
          <p className={styles.text}>{loginState.message}</p>
        )}
        {loginState.phase === "success" && (
          <p className={styles.success}>{t("Connected successfully.")}</p>
        )}
        {loginState.phase === "error" && (
          <p className={styles.error}>{loginState.message}</p>
        )}
      </div>

      <div className={styles.actions}>
        {isWorking ? (
          <button type="button" className={styles.ghost} onClick={() => cancelOAuthLogin(provider.id)}>
            {t("Cancel")}
          </button>
        ) : (
          <>
            <button type="button" className={styles.primary} onClick={handleLogin}>
              {provider.loggedIn ? t("Re-login") : t("Login")}
            </button>
            {provider.loggedIn && (
              <button type="button" className={styles.danger} onClick={handleLogout}>
                {t("Disconnect")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

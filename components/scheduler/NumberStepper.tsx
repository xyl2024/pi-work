/**
 * NumberStepper — 紧凑型整数步进器：[- 数字 +]，取代原生
 * `<input type="number">` 的丑陋 spinner。用于"每 N 小时"等需要 1–N
 * 范围整数输入的场景。
 *
 * 设计要点：
 *   - 受控 value（number；NaN 表示空）。输入流实时 clamp 到 [min, max]
 *     并同步 draft，避免用户输入超界值后还要手动删字符。
 *   - 按钮、键盘 ↑↓、输入框直输三种交互并存。越界时按钮 disabled。
 *   - 视觉上是一个连续的 group，左右两侧按钮带分隔线；group focus 状态
 *     时整体边框高亮（accent），按钮 hover/active 用 bg-hover/bg-selected。
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface NumberStepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  /** 数字框宽度（px）。 */
  width?: number;
}

export function NumberStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  step = 1,
  ariaLabel,
  placeholder,
  disabled = false,
  width = 44,
}: NumberStepperProps) {
  const [draft, setDraft] = useState<string>(() =>
    Number.isInteger(value) ? String(value) : "",
  );
  const [focused, setFocused] = useState(false);
  const [hover, setHover] = useState<"none" | "dec" | "inc">("none");
  const [active, setActive] = useState<"none" | "dec" | "inc">("none");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 外部 value 变化时同步 draft。输入框正在编辑时不打断用户。
  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    setDraft(Number.isInteger(value) ? String(value) : "");
  }, [value]);

  const clamp = useCallback((n: number) => {
    const rounded = Math.round(n);
    if (rounded < min) return min;
    if (rounded > max) return max;
    return rounded;
  }, [min, max]);

  const commit = useCallback((next: number) => {
    if (next !== value) onChange(next);
    setDraft(String(next));
  }, [onChange, value]);

  const dec = () => {
    const base = Number.isInteger(value) ? value : max;
    commit(clamp(base - step));
  };
  const inc = () => {
    const base = Number.isInteger(value) ? value : min;
    commit(clamp(base + step));
  };

  const atMin = Number.isInteger(value) && value <= min;
  const atMax = Number.isInteger(value) && value >= max;

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.currentTarget as HTMLInputElement).blur();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      inc();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      dec();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(Number.isInteger(value) ? String(value) : "");
      (e.currentTarget as HTMLInputElement).blur();
    }
  };

  const btnBase = (side: "dec" | "inc"): React.CSSProperties => {
    const isHover = hover === side;
    const isActive = active === side;
    const isDisabled = disabled || (side === "dec" ? atMin : atMax);
    return {
      width: 26,
      padding: 0,
      border: "none",
      background: isActive ? "var(--bg-selected)" : isHover ? "var(--bg-hover)" : "transparent",
      color: isDisabled ? "var(--text-dim)" : "var(--text-muted)",
      cursor: isDisabled ? "default" : "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "background 0.1s, color 0.1s",
    };
  };

  return (
    <div
      data-disabled={disabled || undefined}
      style={{
        display: "inline-flex",
        alignItems: "stretch",
        height: 28,
        border: `1px solid ${focused ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 6,
        background: "var(--bg)",
        overflow: "hidden",
        opacity: disabled ? 0.5 : 1,
        transition: "border-color 0.1s",
      }}
    >
      <button
        type="button"
        onClick={dec}
        disabled={disabled || atMin}
        aria-label={ariaLabel ? `${ariaLabel} decrease` : "Decrease"}
        tabIndex={-1}
        onMouseEnter={() => setHover("dec")}
        onMouseLeave={() => { setHover("none"); setActive("none"); }}
        onMouseDown={() => setActive("dec")}
        onMouseUp={() => setActive("none")}
        style={{ ...btnBase("dec"), borderRight: "1px solid var(--border)" }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
          <line x1="2" y1="5" x2="8" y2="5" />
        </svg>
      </button>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d]/g, "");
          setDraft(v);
          if (v === "") {
            if (Number.isInteger(value)) onChange(NaN);
            return;
          }
          const num = Number(v);
          if (Number.isFinite(num)) commit(clamp(num));
        }}
        onKeyDown={handleKey}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onBlur={() => setFocused(false)}
        style={{
          width,
          padding: 0,
          textAlign: "center",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          color: "var(--text)",
          background: "transparent",
          border: "none",
          outline: "none",
        }}
      />
      <button
        type="button"
        onClick={inc}
        disabled={disabled || atMax}
        aria-label={ariaLabel ? `${ariaLabel} increase` : "Increase"}
        tabIndex={-1}
        onMouseEnter={() => setHover("inc")}
        onMouseLeave={() => { setHover("none"); setActive("none"); }}
        onMouseDown={() => setActive("inc")}
        onMouseUp={() => setActive("none")}
        style={{ ...btnBase("inc"), borderLeft: "1px solid var(--border)" }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
          <line x1="2" y1="5" x2="8" y2="5" />
          <line x1="5" y1="2" x2="5" y2="8" />
        </svg>
      </button>
    </div>
  );
}
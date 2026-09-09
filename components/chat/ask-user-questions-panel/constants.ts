/** Fixed pixel height of the sticky panel — chosen to fit one question
 *  card with options + a small footer without dominating the chat. The
 *  tab bar at the top and the Submit/Cancel row at the bottom sit inside
 *  this height; only the question card scrolls. */
export const PANEL_HEIGHT_PX = 350;

/** Delay before auto-advancing to the next question after a single-select
 *  pick — long enough to register the choice, short enough to feel snappy. */
export const AUTO_ADVANCE_MS = 450;

/** Slightly longer window before auto-submitting on the last question so a
 *  stray click doesn't fire the tool before the user can notice. */
export const AUTO_SUBMIT_MS = 700;

/** How long the "Answers sent" confirmation stays before the panel closes. */
export const SENT_VIEW_MS = 1400;

/** Inline CSS for the panel's animations + icon-button affordance. Hoisted
 *  out of the component so the literal only allocates once per module load
 *  (the tab bar and footer both target the same .askq-icon-btn class). */
export const ASK_PANEL_STYLES = `
  @keyframes ask-panel-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes askq-fade-up {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .ask-panel-in { animation: ask-panel-in 180ms ease-out; }
  .askq-fade-up { animation: askq-fade-up 220ms ease-out; }
  .askq-fade-up-delayed { animation: askq-fade-up 350ms ease-out 120ms both; }
  .askq-sent-pop { animation: saved-pop 0.45s ease; }
  .askq-sent-check { animation: saved-check-draw 0.35s ease forwards; }
  .askq-icon-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; border-radius: 6px; flex-shrink: 0;
    background: transparent; border: none; cursor: pointer;
    color: var(--text-dim); transition: color 0.1s, background-color 0.1s;
  }
  .askq-icon-btn:hover { background: var(--bg-hover); color: var(--text); }
  .askq-icon-btn:disabled { opacity: 0.35; cursor: default; }
  .askq-icon-btn:disabled:hover { background: transparent; color: var(--text-dim); }
  /* ── Option rows (radio / checkbox) ──────────────────────────────────
     Row: borderless at rest (just a hover wash); when checked it gains
     a soft accent tint + hairline accent border, like modern pickers
     (Linear / Notion). The native input stays hidden-but-focusable for
     keyboard + screen-reader semantics; a drawn marker carries the
     visual state: a donut radio and an accent-fill checkbox with a
     stroke-drawn check. Hover / checked / focus-visible states all live
     here so the JSX only toggles one class. */
  .askq-opt {
    display: flex; align-items: flex-start; gap: 11px;
    padding: 9px 12px; border-radius: 10px;
    border: 1px solid transparent;
    background: transparent; cursor: pointer;
    transition: background-color 0.13s ease, border-color 0.13s ease;
  }
  .askq-opt:hover { background: var(--bg-hover); }
  .askq-opt.askq-checked {
    background: color-mix(in srgb, var(--accent) 7%, transparent);
    border-color: color-mix(in srgb, var(--accent) 38%, transparent);
  }
  .askq-opt.askq-checked:hover {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .askq-input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; }
  .askq-opt:has(.askq-input:focus-visible) {
    outline: 2px solid var(--accent); outline-offset: 1px;
  }
  .askq-marker {
    position: relative; flex-shrink: 0;
    box-sizing: border-box; width: 14px; height: 14px; margin-top: 2px;
    transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  /* Tactile press: the marker shrinks a touch while the row is held. */
  .askq-opt:active .askq-marker { transform: scale(0.85); }
  /* Radio: a thin ring at rest; checked fades the ring out entirely —
     only the accent check remains, floating over the row tint. */
  .askq-radio {
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--text-dim) 75%, transparent);
    transition: background-color 0.15s ease, border-color 0.15s ease;
  }
  .askq-opt:hover .askq-radio {
    border-color: color-mix(in srgb, var(--text-muted) 85%, transparent);
  }
  .askq-opt.askq-checked .askq-radio {
    border-color: transparent;
  }
  /* Checkbox: rounded square at rest; checked fades the box out — same
     "check only" treatment as the radio. */
  .askq-checkbox {
    border-radius: 4.5px;
    border: 2px solid color-mix(in srgb, var(--text-dim) 75%, transparent);
    transition: background-color 0.15s ease, border-color 0.15s ease;
  }
  .askq-opt:hover .askq-checkbox {
    border-color: color-mix(in srgb, var(--text-muted) 85%, transparent);
  }
  .askq-opt.askq-checked .askq-checkbox {
    border-color: transparent;
  }
  .askq-checkbox-check {
    position: absolute; left: 50%; top: 50%;
    color: var(--accent);
    transform: translate(-50%, -50%) scale(0.4); opacity: 0;
    transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.12s ease;
  }
  .askq-opt.askq-checked .askq-checkbox-check {
    transform: translate(-50%, -50%) scale(1); opacity: 1;
  }
  .askq-checkbox-check path {
    stroke-dasharray: 16; stroke-dashoffset: 16;
  }
  .askq-opt.askq-checked .askq-checkbox-check path {
    animation: askq-check-draw 0.22s ease 0.05s forwards;
  }
  @keyframes askq-check-draw {
    to { stroke-dashoffset: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .ask-panel-in, .askq-fade-up, .askq-fade-up-delayed,
    .askq-sent-pop, .askq-sent-check,
    .askq-radio, .askq-checkbox, .askq-checkbox-check {
      animation: none !important;
      transition: none !important;
    }
    .askq-checkbox-check path { stroke-dashoffset: 0; }
  }
`;

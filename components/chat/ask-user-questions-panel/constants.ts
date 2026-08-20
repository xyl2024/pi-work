/** Fixed pixel height of the sticky panel — chosen to fit one question
 *  card with options + a small footer without dominating the chat. The
 *  tab bar at the top and the Submit/Cancel row at the bottom sit inside
 *  this height; only the question card scrolls. */
export const PANEL_HEIGHT_PX = 280;

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
  @media (prefers-reduced-motion: reduce) {
    .ask-panel-in, .askq-fade-up, .askq-fade-up-delayed,
    .askq-sent-pop, .askq-sent-check {
      animation: none !important;
    }
  }
`;

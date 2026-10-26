/**
 * The red the full-access state owns (ADR-0021).
 *
 * One module, three consumers — the toolbar shield, the tab/sidebar badge and
 * the input container's border — because "is this the same signal?" is answered
 * by the eye, and three near-reds would read as three different states. The
 * border is the same red at a lower alpha so it sits on any background without
 * becoming a glowing frame.
 */
export const FULL_ACCESS_RED = "#ef4444";

/** The input container's border while the session is in full access. */
export const FULL_ACCESS_BORDER_COLOR = "rgba(239, 68, 68, 0.85)";

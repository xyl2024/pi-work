/**
 * The two permission modes a session can be in (ADR-0021).
 *
 * `confirm` is the behaviour Pi Work has always had: a shell command that
 * matches a dangerous-command rule stops and asks. `full_access` is the human
 * saying "I authorize this session" — inside it, a rule match is treated as no
 * match at all. Self-protection is NOT part of the difference: it is decided
 * before the mode is consulted, in every mode.
 *
 * This module is shared on purpose. The server needs the type for the sidecar
 * file, the RPC payload and the gate; the client needs it for the runtime
 * state, the reducer, the toggle and the badges. Declaring it twice would let
 * "what the box says" and "what the gate does" drift apart.
 *
 * There is deliberately no third value and no "unknown ⇒ full access" path:
 * an unrecognised wire or file value is *not* a mode (ADR-0008 records the
 * "unknown decision means allow" trap; the same mistake must not be repeated
 * here).
 */

/** Every legal mode, enumerable so both the RPC validator and the tests read
 *  the same list instead of repeating the literals. */
export const PERMISSION_MODES = ["confirm", "full_access"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** What a session that never opted in reports — and what a missing, unreadable
 *  or corrupt sidecar file reduces to. */
export const DEFAULT_PERMISSION_MODE: PermissionMode = "confirm";

/**
 * The other mode — what one click on the shield does. Both entry points (the
 * toolbar button and the palette entry) ask this rather than spelling the
 * ternary out twice, so the two can never flip in opposite directions.
 */
export function flippedPermissionMode(mode: PermissionMode): PermissionMode {
  return mode === "full_access" ? "confirm" : "full_access";
}

/** Whether a wire / file value is one of the two modes. Never coerces. */
export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && (PERMISSION_MODES as readonly string[]).includes(value);
}

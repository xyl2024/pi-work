// Self-protection for Pi Work's agent bash tool.
//
// The agent's bash tool can — by accident or by over-eager cleanup — run
// commands that kill the very server the agent is running in (e.g.
// `pkill node`, `fuser -k <port>/tcp`, `kill $PPID`, `shutdown`). This module
// is a CODE-LEVEL hard guard, deliberately NOT driven by the user-editable
// dangerous-patterns config: commands that would kill this server process are
// blocked unconditionally, with no permission prompt and no per-session
// allowance.
//
// Design goals, in order:
// 1. Never let a bash command kill this server process.
// 2. Minimal false positives on unrelated commands (curl, grep, killing an
//    unrelated pid, `echo $PPID`, ...).
//
// Matching is best-effort heuristics over the command string — shells make
// provable analysis impossible — so it covers the common kill forms while
// staying quiet on non-kill usage of the same words.

/** Runtime facts about THIS server process used to detect self-targeting. */
export interface SelfKillContext {
  /** PID of the server (node) process. */
  pid: number;
  /** Port this server listens on (from argv -p/--port, PORT env, or next's 3000 default). */
  port: number;
}

/** Resolve the port this Next.js server listens on. */
function resolveOwnPort(): number {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === "-p" || a === "--port") && i + 1 < argv.length) {
      const n = Number.parseInt(argv[i + 1], 10);
      if (Number.isInteger(n) && n > 0 && n < 65536) return n;
    }
    if (a.startsWith("--port=")) {
      const n = Number.parseInt(a.slice("--port=".length), 10);
      if (Number.isInteger(n) && n > 0 && n < 65536) return n;
    }
  }
  if (process.env.PORT) {
    const n = Number.parseInt(process.env.PORT, 10);
    if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  }
  // Next.js's default when no -p / PORT is given.
  return 3000;
}

/** Production context: this server's own pid and listening port. */
function getOwnContext(): SelfKillContext {
  return { pid: process.pid, port: resolveOwnPort() };
}

// Exposed for tests / debugging
export function _getOwnContext(): SelfKillContext {
  return getOwnContext();
}

// ── Building blocks ─────────────────────────────────────────────────────────

/**
 * Anything that terminates processes: kill / pkill / killall / fuser -k /
 * npx kill-port / xargs kill. `\bkill\b` also matches `kill-port` ("- " is a
 * word boundary) but not `skill` / `killed`.
 */
const KILL_TOKEN =
  /\b(?:p?kill|killall)\b|\bfuser\b[^;&|]*\s-(?:k|K)\b|\bxargs\b[^;&|]*\bkill\b|\bkill\b[^;&|]*\bxargs\b/;

/**
 * Commands that take down the whole machine (and therefore this server).
 * The word must start a command segment (start / after ; | & ( or a newline,
 * optionally via sudo/doas) so `grep reboot /var/log` stays allowed.
 */
const SYSTEM_DOWN =
  /(?:^|[;&|(|\n])\s*(?:sudo\s+|doas\s+|env\s+\S+\s+)*(?:shutdown|reboot|poweroff|halt)\b|\binit\s+0\b|\bsystemctl\s+(?:poweroff|reboot|halt)\b/;

/** Broad process-name killers that always include this server among their victims. */
function matchBroadKiller(cmd: string): string | null {
  if (!/\b(?:pkill|killall)\b/.test(cmd)) return null;
  if (/\bnode\b/.test(cmd) || /node_modules/.test(cmd)) {
    return "broad process kill by 'node' name would terminate this server";
  }
  if (/\bnext\b/.test(cmd)) return "broad process kill by 'next' name would terminate this server";
  if (/pi[-_]work|run_pi_work/.test(cmd)) {
    return "broad process kill by 'pi-work' path would terminate this server";
  }
  // pkill -u <user> / -g <pgid> / -s <sid> with no narrowing pattern kills
  // every process in that scope — this server included.
  if (/\bpkill\b[^;&|]*\s(?:-u|--uid|--euid)\b/.test(cmd)) return "pkill by user would terminate this server";
  if (/\bpkill\b[^;&|]*\s(?:-g|--pgid)\b/.test(cmd)) return "pkill by process group would terminate this server";
  if (/\bpkill\b[^;&|]*\s(?:-s|--session)\b/.test(cmd)) return "pkill by session id would terminate this server";
  return null;
}

/**
 * Match a bash command against self-kill patterns.
 * Returns the reason of the first match, or null when the command is allowed.
 * `ctx` is injectable for tests; production uses this server's real pid/port.
 */
export function matchSelfKillCommand(command: string, ctx: SelfKillContext = getOwnContext()): { reason: string } | null {
  const cmd = command;
  if (SYSTEM_DOWN.test(cmd)) {
    return { reason: "system-level shutdown/reboot would terminate this server" };
  }
  const broad = matchBroadKiller(cmd);
  if (broad) return { reason: broad };

  // The production launcher script: it kills whatever listens on the server
  // port before starting a new instance — running it from the agent kills
  // this very server. Checked regardless of KILL_TOKEN (the script name
  // itself contains no kill word).
  if (/run_pi[_-]work\.sh|pi-work-start/.test(cmd)) {
    return { reason: "the pi-work launcher kills the process on the server port before restarting — running it here kills this server" };
  }

  if (KILL_TOKEN.test(cmd)) {
    // 1. Shell-parent suicide: `kill $PPID` / `${PPID}`, or a ppid lookup
    //    piped into kill (`ps -o ppid= -p $$ | xargs kill`).
    if (/\$\{?PPID\}?/.test(cmd)) {
      return { reason: "command would kill this server process ($PPID of the spawned shell)" };
    }
    if (/\bppid\b/i.test(cmd) && /\b(?:xargs|kill)\b/.test(cmd)) {
      return { reason: "command kills its parent PID — the Pi Work server" };
    }
    // 2. Explicit self-pid: `kill -9 <this server's pid>`.
    if (new RegExp(`\\b(?:kill|pkill|killall)\\b[^;&|]*\\b${ctx.pid}\\b`).test(cmd)) {
      return { reason: `command targets this server's PID (${ctx.pid})` };
    }
    // 3. Port-based kill of the process listening on our port:
    //    `fuser -k 14514/tcp`, `kill $(lsof -ti:14514)`, `npx kill-port 14514`.
    if (new RegExp(`\\b${ctx.port}\\b`).test(cmd)) {
      return { reason: `command kills the process listening on this server's port (${ctx.port})` };
    }
    // 4. Process-group suicide: `kill -9 -1`, `kill -- -<pgid>`, `kill 0`.
    //    `kill -1 <pid>` (SIGHUP to one pid) stays allowed — the negative
    //    number must not be the first token after `kill`.
    if (/\bkill\b[^;&|]*\s--\s+-\d/.test(cmd) || /\bkill\b\s+\S+\s+--\s+-\d/.test(cmd) || /\bkill\b\s+\S+\s+-\d/.test(cmd)) {
      return { reason: "kill with a negative/-1 target takes down every process including this server" };
    }
    if (/\bkill\b(?:\s+-\w+)*\s+0\s*(?:$|[;|&])/.test(cmd)) {
      return { reason: "kill 0 signals the whole process group including this server" };
    }
    // 5. Enumerate-then-kill pipelines aimed at node/next/pi-work processes:
    //    `ps aux | grep next | xargs kill`, `kill $(pgrep -f node)`.
    if (
      /\b(?:pgrep|ps)\b/.test(cmd) &&
      /\b(?:node|next)\b|pi[-_]work|node_modules/.test(cmd) &&
      /\bxargs\b|\bkill\b/.test(cmd)
    ) {
      return { reason: "command enumerates node/next/pi-work processes and kills them — this server among them" };
    }
  }
  return null;
}

export interface SelfKillContext {
  pid: number;
  port: number;
}

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
  return 3000;
}

function getOwnContext(): SelfKillContext {
  return { pid: process.pid, port: resolveOwnPort() };
}

export function _getOwnContext(): SelfKillContext {
  return getOwnContext();
}

const KILL_TOKEN =
  /\b(?:p?kill|killall)\b|\bfuser\b[^;&|]*\s-(?:k|K)\b|\bxargs\b[^;&|]*\bkill\b|\bkill\b[^;&|]*\bxargs\b/;

const SYSTEM_DOWN =
  /(?:^|[;&|(|\n])\s*(?:sudo\s+|doas\s+|env\s+\S+\s+)*(?:shutdown|reboot|poweroff|halt)\b|\binit\s+0\b|\bsystemctl\s+(?:poweroff|reboot|halt)\b/;

function matchBroadKiller(cmd: string): string | null {
  if (!/\b(?:pkill|killall)\b/.test(cmd)) return null;
  if (/\bnode\b/.test(cmd) || /node_modules/.test(cmd)) {
    return "broad process kill by 'node' name would terminate this server";
  }
  if (/\bnext\b/.test(cmd)) return "broad process kill by 'next' name would terminate this server";
  if (/pi[-_]work|run_pi_work/.test(cmd)) {
    return "broad process kill by 'pi-work' path would terminate this server";
  }
  if (/\bpkill\b[^;&|]*\s(?:-u|--uid|--euid)\b/.test(cmd)) return "pkill by user would terminate this server";
  if (/\bpkill\b[^;&|]*\s(?:-g|--pgid)\b/.test(cmd)) return "pkill by process group would terminate this server";
  if (/\bpkill\b[^;&|]*\s(?:-s|--session)\b/.test(cmd)) return "pkill by session id would terminate this server";
  return null;
}

export function matchSelfKillCommand(command: string, ctx: SelfKillContext = getOwnContext()): { reason: string } | null {
  const cmd = command;
  if (SYSTEM_DOWN.test(cmd)) {
    return { reason: "system-level shutdown/reboot would terminate this server" };
  }
  const broad = matchBroadKiller(cmd);
  if (broad) return { reason: broad };

  if (/run_pi[_-]work\.sh|pi-work-start/.test(cmd)) {
    return { reason: "the pi-work launcher kills the process on the server port before restarting — running it here kills this server" };
  }

  if (KILL_TOKEN.test(cmd)) {
    if (/\$\{?PPID\}?/.test(cmd)) {
      return { reason: "command would kill this server process ($PPID of the spawned shell)" };
    }
    if (/\bppid\b/i.test(cmd) && /\b(?:xargs|kill)\b/.test(cmd)) {
      return { reason: "command kills its parent PID — the Pi Work server" };
    }
    if (new RegExp(`\\b(?:kill|pkill|killall)\\b[^;&|]*\\b${ctx.pid}\\b`).test(cmd)) {
      return { reason: `command targets this server's PID (${ctx.pid})` };
    }
    if (new RegExp(`\\b${ctx.port}\\b`).test(cmd)) {
      return { reason: `command kills the process listening on this server's port (${ctx.port})` };
    }
    if (/\bkill\b[^;&|]*\s--\s+-\d/.test(cmd) || /\bkill\b\s+\S+\s+--\s+-\d/.test(cmd) || /\bkill\b\s+\S+\s+-\d/.test(cmd)) {
      return { reason: "kill with a negative/-1 target takes down every process including this server" };
    }
    if (/\bkill\b(?:\s+-\w+)*\s+0\s*(?:$|[;|&])/.test(cmd)) {
      return { reason: "kill 0 signals the whole process group including this server" };
    }
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

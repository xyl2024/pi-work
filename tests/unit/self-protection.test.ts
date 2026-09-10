import { describe, expect, it } from "vitest";
import { _getOwnContext, matchSelfKillCommand, type SelfKillContext } from "@/lib/server/self-protection";

// Fixed fake server facts so assertions are deterministic. The port also
// exercises that only the configured instance port triggers port rules.
const ctx: SelfKillContext = { pid: 123456, port: 14514 };

const blocked = (cmd: string, expectIn: RegExp) => {
  const m = matchSelfKillCommand(cmd, ctx);
  expect(m, `expected block: ${cmd}`).not.toBeNull();
  expect(m?.reason, `reason for: ${cmd}`).toMatch(expectIn);
};

const allowed = (cmd: string) => {
  expect(matchSelfKillCommand(cmd, ctx), `expected allow: ${cmd}`).toBeNull();
};

describe("matchSelfKillCommand", () => {
  it("allows ordinary commands", () => {
    allowed("ls -la");
    allowed("curl -s http://localhost:14514/api/health");
    allowed("ss -tlnp 'sport = :14514'");
    allowed("lsof -i :14514");
    allowed("grep -rn 14514 ~/.pi-work/config.yaml");
    allowed("echo $PPID");
    allowed("echo $$");
    allowed("kill -0 99999");
    allowed("kill -1 99999");
    allowed("kill -9 99999");
    allowed("pkill -f my-worker");
    allowed("killall my-daemon");
    allowed("node scripts/build.mjs && kill $(cat /tmp/other.pid)");
    allowed("ps aux | grep postgres");
    allowed("git status && npm test");
    allowed("grep reboot /var/log/syslog");
    allowed("fuser 14514/tcp");
    // Non-kill usage of our pid/port digits.
    allowed("echo 'server pid 123456 listens on 14514'");
    allowed("curl -s localhost:14514 && cat /proc/123456/status");
  });

  it("blocks shell-parent suicide", () => {
    blocked("kill $PPID", /\$PPID/);
    blocked("kill -9 ${PPID}", /\$PPID/);
    blocked("ps -o ppid= -p $$ | xargs kill", /parent PID/);
    blocked("kill $(ps --no-headers -o ppid -p $$)", /parent PID/);
  });

  it("blocks explicit self-pid kill", () => {
    blocked("kill -9 123456", /PID/);
    blocked("kill 123456", /PID/);
    blocked("pkill -TERM -x 123456", /PID/);
  });

  it("blocks port-based kill of the listening process", () => {
    blocked("fuser -k 14514/tcp", /port/);
    blocked("kill -9 $(lsof -ti:14514)", /port/);
    blocked("npx kill-port 14514", /port/);
    blocked("kill $(ss -tlnp 'sport = :14514' | grep -oP 'pid=\\K\\d+')", /port/);
    blocked("kill -9 $(netstat -tlnp | awk '/14514/ {print $7}')", /port/);
  });

  it("blocks process-group / all-process suicide", () => {
    blocked("kill -9 -1", /negative/);
    blocked("kill -- -1", /negative/);
    blocked("kill -9 -- -1", /negative/);
    blocked("kill 0", /process group/);
    blocked("kill -9 0", /process group/);
  });

  it("blocks broad killers by node/next/pi-work name", () => {
    blocked("pkill node", /'node'/);
    blocked("pkill -9 node", /'node'/);
    blocked("killall node", /'node'/);
    blocked("pkill -f node_modules/.bin/next", /'node'/);
    blocked("pkill next", /'next'/);
    blocked("pkill -f 'next start'", /'next'/);
    blocked("killall next", /'next'/);
    blocked("pkill -f pi-work", /'pi-work'/);
    blocked("pkill -f run_pi_work.sh", /'pi-work'/);
    blocked("pkill -u alone", /user/);
    blocked("pkill -g 4242", /process group/);
    blocked("pkill -s 4242", /session id/);
  });

  it("blocks enumerate-then-kill pipelines", () => {
    blocked("ps aux | grep next | grep -v grep | xargs kill", /enumerates/);
    blocked("pgrep -f node | xargs kill -9", /enumerates/);
    blocked("kill $(pgrep node)", /enumerates/);
    blocked("kill -9 $(ps -ef | awk '/node/ {print $2}')", /enumerates/);
  });

  it("blocks the launcher script (it kills the port owner)", () => {
    blocked("bash ~/.xyl_scripts/run_pi_work.sh", /launcher/);
    blocked("/home/alone/.xyl_scripts/run_pi_work.sh", /launcher/);
    blocked("zsh -c 'run_pi_work.sh'", /launcher/);
  });

  it("blocks system-level shutdown commands", () => {
    blocked("shutdown -h now", /shutdown/);
    blocked("sudo reboot", /shutdown/);
    blocked("poweroff", /shutdown/);
    blocked("systemctl reboot", /shutdown/);
    blocked("sudo shutdown -r +5", /shutdown/);
    blocked("init 0", /shutdown/);
  });

  it("blocks composite commands where one segment kills self", () => {
    blocked("npm test && pkill node", /'node'/);
    blocked("cd /tmp; kill $PPID", /\$PPID/);
  });

  it("uses the real process pid/port by default", () => {
    // The default context must reflect the real server process.
    expect(_getOwnContext().pid).toBe(process.pid);
    // With default context the literal pid of the current process is caught.
    expect(matchSelfKillCommand(`kill -9 ${process.pid}`), "expected block (default ctx)").toMatchObject({ reason: expect.stringMatching(/PID/) });
    if (process.env.PORT) {
      expect(matchSelfKillCommand(`fuser -k ${Number(process.env.PORT)}/tcp`), "expected block (default ctx port)").toMatchObject({ reason: expect.stringMatching(/port/) });
    }
  });
});

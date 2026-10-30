import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BASH_DANGEROUS_RULES,
  DEFAULT_POWERSHELL_DANGEROUS_RULES,
  assembleDangerousRules,
  buildDangerousRuleSetSnapshot,
  compileDangerousRules,
  defaultDangerousRules,
  matchDangerousCommand,
  resolveDangerousRules,
  resolveDangerousRulesWithSource,
  type CompiledDangerousRule,
} from "@/lib/shared/dangerous-commands";
import type { DangerousPatternRule } from "@/lib/shared/config-types";

const compiled = (rules: readonly DangerousPatternRule[]): CompiledDangerousRule[] =>
  compileDangerousRules(rules).compiled;

const linux = (command: string) => matchDangerousCommand(command, compiled(defaultDangerousRules("linux")));

const windows = (command: string) => matchDangerousCommand(command, compiled(defaultDangerousRules("win32")));

function allowed(matcher: (command: string) => { ruleName: string } | null, command: string): void {
  expect(matcher(command), `expected allow: ${command}`).toBeNull();
}

function blocked(
  matcher: (command: string) => { ruleName: string } | null,
  command: string,
  ruleName: string,
): void {
  expect(matcher(command), `expected block: ${command}`).toEqual({ ruleName });
}

describe("defaultDangerousRules", () => {
  it("gives every platform the bash set", () => {
    expect(defaultDangerousRules("linux")).toEqual([...DEFAULT_BASH_DANGEROUS_RULES]);
    expect(defaultDangerousRules("darwin")).toEqual([...DEFAULT_BASH_DANGEROUS_RULES]);
  });

  it("adds the PowerShell set only on Windows, where the tool exists", () => {
    const win = defaultDangerousRules("win32");

    expect(win).toEqual([
      ...DEFAULT_BASH_DANGEROUS_RULES,
      ...DEFAULT_POWERSHELL_DANGEROUS_RULES,
    ]);
    expect(defaultDangerousRules("linux")).not.toContain(
      DEFAULT_POWERSHELL_DANGEROUS_RULES[0],
    );
  });

  it("names every rule, so the confirmation dialog can say which one fired", () => {
    for (const rule of [...DEFAULT_BASH_DANGEROUS_RULES, ...DEFAULT_POWERSHELL_DANGEROUS_RULES]) {
      expect(rule.name.length).toBeGreaterThan(0);
      expect(rule.pattern.length).toBeGreaterThan(0);
    }
  });
});

describe("default bash rules", () => {
  it("catches recursive forced deletes", () => {
    blocked(linux, "rm -rf /", "rm -rf");
    blocked(linux, "rm -rf ~/project", "rm -rf");
    blocked(linux, "sudo rm -fr /var/lib", "rm -rf");
    blocked(linux, "rm --recursive --force ./build", "rm -rf");
    blocked(linux, "rm -Rf ./dist", "rm -rf");
  });

  it("catches filesystem formatting and raw device writes", () => {
    blocked(linux, "mkfs.ext4 /dev/sda1", "mkfs");
    blocked(linux, "dd if=/dev/zero of=/dev/sda bs=1M", "dd to a device");
    blocked(linux, "wipefs -a /dev/sdb", "wipefs");
    blocked(linux, "echo boom > /dev/sda", "write to a block device");
  });

  it("catches disk partitioning", () => {
    blocked(linux, "fdisk /dev/sda", "disk partitioning");
    blocked(linux, "sudo parted /dev/sda mklabel gpt", "disk partitioning");
  });

  it("catches taking the machine down", () => {
    blocked(linux, "shutdown -h now", "shutdown / reboot");
    blocked(linux, "sudo reboot", "shutdown / reboot");
    blocked(linux, "systemctl poweroff", "shutdown / reboot");
  });

  it("catches a fork bomb and a world-writable root", () => {
    blocked(linux, ":(){ :|:& };:", "fork bomb");
    blocked(linux, "chmod -R 777 /", "chmod -R 777 /");
  });

  it("lets harmless commands through", () => {
    allowed(linux, "git status");
    allowed(linux, "ls -la");
    allowed(linux, "rm file.txt");
    allowed(linux, "rm -r ./node_modules");
    allowed(linux, "fdisk -l");
    allowed(linux, "grep reboot /var/log/syslog");
    allowed(linux, "npm run build && git commit -m 'cleanup'");
  });

  it("does not match the Windows-only PowerShell set", () => {
    allowed(linux, "Remove-Item -Recurse -Force C:\\Users\\me\\project");
    allowed(linux, "Stop-Computer -Force");
  });
});

describe("default PowerShell rules", () => {
  it("catches recursive forced deletes, in any casing", () => {
    blocked(windows, "Remove-Item -Recurse -Force C:\\Users\\me\\project", "Remove-Item -Recurse -Force");
    blocked(windows, "remove-item -recurse -force .", "Remove-Item -Recurse -Force");
    blocked(windows, "ri -Recurse -Force .", "Remove-Item -Recurse -Force");
    blocked(windows, "rd /s /q C:\\Windows", "rd /s /q");
    blocked(windows, "del /s /q D:\\data", "rd /s /q");
  });

  it("catches formatting a disk", () => {
    blocked(windows, "Format-Volume -DriveLetter D -Confirm:$false", "Format-Volume");
    blocked(windows, "Clear-Disk -Number 1 -RemoveData", "Format-Volume");
    blocked(windows, "format D: /q", "Format-Volume");
    blocked(windows, "format /q D:", "Format-Volume");
  });

  it("catches disk partitioning", () => {
    blocked(windows, "New-Partition -DiskNumber 0 -UseMaximumSize", "disk partition");
    blocked(windows, "Remove-Partition -DiskNumber 0 -PartitionNumber 1", "disk partition");
    blocked(windows, "diskpart", "disk partition");
  });

  it("catches deleting a registry key", () => {
    blocked(windows, "Remove-Item -Path HKLM:\\Software\\Foo -Recurse", "registry delete");
    blocked(windows, "Remove-ItemProperty -Path 'HKCU:\\Software\\Foo' -Name Bar", "registry delete");
    blocked(windows, "del HKLM:\\Software\\Foo", "registry delete");
    blocked(windows, "reg delete HKLM\\Software\\Foo /f", "registry delete");
  });

  it("catches shutting the machine down", () => {
    blocked(windows, "Stop-Computer -Force", "Stop-Computer");
    blocked(windows, "Restart-Computer", "Stop-Computer");
    blocked(windows, "shutdown /s /t 0", "shutdown / reboot");
  });

  it("lets harmless commands through", () => {
    allowed(windows, "git status");
    allowed(windows, "Get-ChildItem -Recurse");
    allowed(windows, "Get-Content .\\README.md");
    allowed(windows, "Remove-Item .\\tmp.txt");
    allowed(windows, "Format-Table -AutoSize");
    allowed(windows, "Format-Hex C:\\file.bin");
    allowed(windows, "Get-Partition");
  });
});

describe("resolveDangerousRules", () => {
  const userRule: DangerousPatternRule = { name: "custom-git-status", pattern: "git\\s+status" };
  const withUserRules = (rules: readonly DangerousPatternRule[]) =>
    (command: string) => matchDangerousCommand(command, compiled(rules));

  it("keeps the built-in set underneath the user's rules", () => {
    const rules = resolveDangerousRules("win32", [userRule]);

    blocked(withUserRules(rules), "git status", "custom-git-status");
    blocked(withUserRules(rules), "rm -rf /", "rm -rf");
    blocked(
      withUserRules(rules),
      "Remove-Item -Recurse -Force C:\\x",
      "Remove-Item -Recurse -Force",
    );
  });

  it("checks the user's rules first, so their name wins a tie", () => {
    const mine: DangerousPatternRule = { name: "my-rm", pattern: "rm -rf" };
    const rules = resolveDangerousRules("linux", [mine]);

    blocked(withUserRules(rules), "rm -rf /", "my-rm");
  });

  it("enforces the built-ins with no user rules at all", () => {
    blocked(withUserRules(resolveDangerousRules("linux", [])), "rm -rf /", "rm -rf");
  });

  it("honours a user rule that opts into case-insensitive matching", () => {
    const shouty: DangerousPatternRule = { name: "shouty", pattern: "danger", ignoreCase: true };
    const rules = resolveDangerousRules("linux", [shouty]);

    blocked(withUserRules(rules), "echo DANGER", "shouty");
  });
});

describe("resolveDangerousRulesWithSource", () => {
  const compiledWithSource = (platform: string, userRules: readonly DangerousPatternRule[]) =>
    compiled(resolveDangerousRulesWithSource(platform, userRules));

  it("reports a user-rule hit as the user's, and still lets their name win a tie", () => {
    const rules = compiledWithSource("linux", [{ name: "my-rm", pattern: "rm -rf" }]);

    expect(matchDangerousCommand("rm -rf /", rules)).toEqual({
      ruleName: "my-rm",
      source: "user",
    });
  });

  it("reports a built-in hit as built-in, including the Windows-only set", () => {
    const rules = compiledWithSource("win32", []);

    expect(matchDangerousCommand("Remove-Item -Recurse -Force C:\\x", rules)).toEqual({
      ruleName: "Remove-Item -Recurse -Force",
      source: "builtin",
    });
    expect(matchDangerousCommand("git status", rules)).toBeNull();
  });

  it("keeps the same rule content and order as the unsourced assembly", () => {
    const userRules: DangerousPatternRule[] = [{ name: "custom", pattern: "custom" }];

    expect(resolveDangerousRulesWithSource("darwin", userRules)).toEqual(
      resolveDangerousRules("darwin", userRules).map((rule, index) => ({
        ...rule,
        source: index === 0 ? "user" : "builtin",
      })),
    );
  });

  it("marks the platform's built-ins without leaking the Windows set elsewhere", () => {
    const linuxBuiltins = resolveDangerousRulesWithSource("linux", []).filter(
      (rule) => rule.source === "builtin",
    );

    expect(linuxBuiltins.map((rule) => rule.name)).toEqual(
      DEFAULT_BASH_DANGEROUS_RULES.map((rule) => rule.name),
    );
  });

  it("gives every compiled rule in the effective set a layer", () => {
    const { rules, compiled: matcherInput } = assembleDangerousRules("win32", [
      { name: "mine", pattern: "mine" },
    ]);

    expect(matcherInput.map((rule) => rule.source)).toEqual(rules.map((rule) => rule.source));
    expect(matcherInput.map((rule) => rule.name)).toEqual(rules.map((rule) => rule.name));
  });
});

describe("buildDangerousRuleSetSnapshot", () => {
  it("returns the platform's built-in set and the user rules that do not compile", () => {
    const snapshot = buildDangerousRuleSetSnapshot("win32", [
      { name: "broken", pattern: "(" },
      { name: "fine", pattern: "fine" },
    ]);

    expect(snapshot.platform).toBe("win32");
    expect(snapshot.builtins).toEqual([...defaultDangerousRules("win32")]);
    expect(snapshot.invalidUserRules).toEqual([
      { name: "broken", error: expect.any(String) },
    ]);
  });

  it("leaves the PowerShell set out on platforms that do not have it", () => {
    const snapshot = buildDangerousRuleSetSnapshot("linux", []);

    expect(snapshot.builtins.map((rule) => rule.name)).not.toContain(
      DEFAULT_POWERSHELL_DANGEROUS_RULES[0].name,
    );
    expect(snapshot.invalidUserRules).toEqual([]);
  });
});

describe("matchDangerousCommand", () => {
  it("returns null for an empty rule list", () => {
    allowed((c) => matchDangerousCommand(c, compiled([])), "rm -rf /");
  });

  it("reports an invalid pattern instead of throwing, and keeps looking", () => {
    const { compiled: rules, invalid } = compileDangerousRules([
      { name: "broken", pattern: "(" },
      { name: "catch-all", pattern: "rm" },
    ]);

    expect(invalid).toEqual([{ name: "broken", pattern: "(", error: expect.any(String) }]);
    blocked((c) => matchDangerousCommand(c, rules), "rm -rf /", "catch-all");
  });

  it("stays case-sensitive unless the rule opts in", () => {
    const rules = compiled([{ name: "lowercase-only", pattern: "danger" }]);

    blocked((c) => matchDangerousCommand(c, rules), "danger", "lowercase-only");
    allowed((c) => matchDangerousCommand(c, rules), "DANGER");
  });
});

describe("the gate's wiring", () => {
  const gate = readFileSync(join(process.cwd(), "lib/server/rpc-manager.ts"), "utf8");
  const evaluator = readFileSync(join(process.cwd(), "lib/server/dangerous-patterns.ts"), "utf8");

  it("matches powershell tool calls, not just bash", () => {
    expect(gate).toContain('isToolCallEventType("powershell"');
  });

  it("runs the unconditional self-protection block before the promptable rule match", () => {
    const selfProtection = evaluator.indexOf("matchSelfKillCommand(command)");
    const dangerousMatch = evaluator.indexOf("matchDangerousPattern(command)");

    expect(selfProtection).toBeGreaterThan(-1);
    expect(selfProtection).toBeLessThan(dangerousMatch);
  });

  it("sends the gate through the evaluation the settings tester also calls", () => {
    expect(gate).toMatch(/evaluateDangerousCommand\(\s*command,/);
    expect(gate).toContain("wrapperRef.current?.permissionMode");
  });

  it("hands the agent the plain reason self-protection blocked the command", () => {
    expect(gate).toContain("blocked by self-protection: ${verdict.reason}");
  });

  it("keeps the mode out of every agent-reachable path", () => {
    const palette = readFileSync(join(process.cwd(), "lib/client/commands.tsx"), "utf8");
    expect(palette).toContain('id: "session.permission_mode"');
    expect(readFileSync(join(process.cwd(), "lib/shared/slash-commands.ts"), "utf8"))
      .not.toContain("permission_mode");
    expect(readFileSync(join(process.cwd(), "lib/server/self-tools/pi-work-call.ts"), "utf8"))
      .not.toContain("permission_mode");
  });
});

import { homedir } from "os";
import { join } from "path";

export const DEFAULT_DATA_DIR = join(homedir(), ".pi-work");

export function getDataDir(): string {
  const override = process.env.PI_WORK_DATA_DIR?.trim();
  if (override) return override;
  return DEFAULT_DATA_DIR;
}

export function dataPath(...parts: string[]): string {
  return join(getDataDir(), ...parts);
}
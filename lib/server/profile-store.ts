import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { createLogger } from "./logger";
import { dataPath } from "./data-dir";

const log = createLogger("profile-store");

export const PROFILE_DIR = dataPath("profile");
const USER_FILE = join(PROFILE_DIR, "user.json");
const AVATAR_META_FILE = join(PROFILE_DIR, "avatar.json");
const AVATAR_BASE = "avatar";
const DEFAULT_AVATAR_MIME = "image/png";

export const SUPPORTED_AVATAR_MIMES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/avif",
] as const;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/avif": "avif",
};

interface AvatarMeta {
  mime: string;
}

function avatarFileForMime(mime: string): string {
  const ext = MIME_TO_EXT[mime] ?? "png";
  return join(PROFILE_DIR, `${AVATAR_BASE}.${ext}`);
}

function readAvatarMeta(): AvatarMeta {
  try {
    if (!existsSync(AVATAR_META_FILE)) return { mime: DEFAULT_AVATAR_MIME };
    const parsed = JSON.parse(readFileSync(AVATAR_META_FILE, "utf8"));
    const mime = typeof parsed?.mime === "string" ? parsed.mime : DEFAULT_AVATAR_MIME;
    return { mime };
  } catch {
    return { mime: DEFAULT_AVATAR_MIME };
  }
}

function writeAvatarMeta(meta: AvatarMeta): void {
  writeFileSync(AVATAR_META_FILE, JSON.stringify(meta, null, 2), "utf8");
}

function cleanupAvatarFiles(): void {
  const dir = PROFILE_DIR;
  if (!existsSync(dir)) return;
  // Legacy avatar.png plus every supported extension.
  const names = new Set<string>([`${AVATAR_BASE}.png`]);
  for (const ext of Object.values(MIME_TO_EXT)) names.add(`${AVATAR_BASE}.${ext}`);
  names.add("avatar.json");
  for (const name of names) {
    const file = join(dir, name);
    if (existsSync(file)) unlinkSync(file);
  }
}

export interface UserProfile {
  username: string | null;
}

const MAX_USERNAME_LENGTH = 64;

function ensureDir(): void {
  mkdirSync(PROFILE_DIR, { recursive: true });
}

function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_USERNAME_LENGTH) {
    throw new Error(`username too long (max ${MAX_USERNAME_LENGTH} chars)`);
  }
  return trimmed;
}

/**
 * Read the user profile from ~/.pi-work/profile/user.json.
 * Returns { username: null } when the file is missing or malformed.
 */
export function readProfile(): UserProfile {
  try {
    if (!existsSync(USER_FILE)) return { username: null };
    const raw = readFileSync(USER_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { username: null };
    const obj = parsed as Record<string, unknown>;
    return { username: normalizeUsername(obj.username) };
  } catch (err) {
    log.warn("failed to read profile, returning empty", { error: String(err) });
    return { username: null };
  }
}

/**
 * Write the user profile to ~/.pi-work/profile/user.json.
 * Returns the normalized profile.
 */
export function writeProfile(profile: UserProfile): UserProfile {
  ensureDir();
  const username = normalizeUsername(profile.username);
  writeFileSync(USER_FILE, JSON.stringify({ username }, null, 2), "utf8");
  log.info("profile written", { username });
  return { username };
}

export function getAvatar(): { buffer: Buffer; mime: string } | null {
  const meta = readAvatarMeta();
  const file = avatarFileForMime(meta.mime);
  // Meta may point to a file that no longer exists (e.g. partial write); fall back to legacy png.
  if (!existsSync(file)) {
    const legacy = join(PROFILE_DIR, "avatar.png");
    if (!existsSync(legacy)) return null;
    return { buffer: readFileSync(legacy), mime: DEFAULT_AVATAR_MIME };
  }
  return { buffer: readFileSync(file), mime: meta.mime };
}

export function avatarExists(): boolean {
  return getAvatar() !== null;
}

export function writeAvatar(buffer: Buffer, mime: string = DEFAULT_AVATAR_MIME): void {
  ensureDir();
  // Remove any previous avatar in another format before writing the new one.
  cleanupAvatarFiles();
  writeFileSync(avatarFileForMime(mime), buffer);
  writeAvatarMeta({ mime });
  log.info("avatar written", { bytes: buffer.length, mime });
}

export function removeAvatar(): void {
  if (!avatarExists()) return;
  cleanupAvatarFiles();
  log.info("avatar removed");
}

export { MAX_USERNAME_LENGTH };
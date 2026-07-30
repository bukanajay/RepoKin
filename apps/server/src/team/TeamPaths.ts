/**
 * Pure path construction and slug derivation for `.agentforge/`.
 *
 * The id field inside a profile is authoritative; filenames are a convenience.
 * Slugs must satisfy the member-id pattern: letter-first, then [A-Za-z0-9_-].
 *
 * @module TeamPaths
 */
import {
  AGENTFORGE_DIR_NAME,
  TEAM_AGENTS_DIR_NAME,
  TEAM_FILE_NAME,
  TEAM_HUMANS_DIR_NAME,
} from "@t3tools/contracts/team";

const MEMBER_SLUG_MAX_CHARS = 64;
const MEMBER_SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/** Join path segments with `/` without depending on Node path (pure + portable). */
export const joinPosix = (...parts: ReadonlyArray<string>): string => {
  const joined = parts
    .flatMap((part) => part.split("/"))
    .filter((segment) => segment.length > 0)
    .join("/");
  return parts[0]?.startsWith("/") ? `/${joined}` : joined;
};

export const agentforgeDir = (workspaceRoot: string): string =>
  joinPosix(workspaceRoot, AGENTFORGE_DIR_NAME);

export const teamFilePath = (workspaceRoot: string): string =>
  joinPosix(agentforgeDir(workspaceRoot), TEAM_FILE_NAME);

export const humansDir = (workspaceRoot: string): string =>
  joinPosix(agentforgeDir(workspaceRoot), TEAM_HUMANS_DIR_NAME);

export const agentsDir = (workspaceRoot: string): string =>
  joinPosix(agentforgeDir(workspaceRoot), TEAM_AGENTS_DIR_NAME);

export const humanProfilePath = (workspaceRoot: string, slug: string): string =>
  joinPosix(humansDir(workspaceRoot), `${slug}.json`);

export const agentProfilePath = (workspaceRoot: string, slug: string): string =>
  joinPosix(agentsDir(workspaceRoot), `${slug}.json`);

/** Repo-relative path of the team directory (for git pathspecs). */
export const agentforgeDirRelative = (): string => AGENTFORGE_DIR_NAME;

export const teamFilePathRelative = (): string => joinPosix(AGENTFORGE_DIR_NAME, TEAM_FILE_NAME);

export const humanProfilePathRelative = (slug: string): string =>
  joinPosix(AGENTFORGE_DIR_NAME, TEAM_HUMANS_DIR_NAME, `${slug}.json`);

export const agentProfilePathRelative = (slug: string): string =>
  joinPosix(AGENTFORGE_DIR_NAME, TEAM_AGENTS_DIR_NAME, `${slug}.json`);

export const isValidMemberSlug = (value: string): boolean =>
  value.length > 0 && value.length <= MEMBER_SLUG_MAX_CHARS && MEMBER_SLUG_PATTERN.test(value);

/**
 * Normalize an arbitrary string into a member slug candidate.
 * Returns null when nothing usable remains.
 */
export const slugifyMemberStem = (raw: string): string | null => {
  const lowered = raw.trim().toLowerCase();
  if (lowered.length === 0) {
    return null;
  }

  // Prefer hyphen for multi-word agent names; collapse other junk to `_`.
  let slug = lowered
    .replaceAll(/[^a-z0-9_-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/_+/g, "_")
    .replaceAll(/^[-_]+|[-_]+$/g, "");

  if (slug.length === 0) {
    return null;
  }

  // Member ids must start with a letter.
  if (!/^[a-zA-Z]/.test(slug)) {
    slug = `m-${slug}`;
  }

  if (slug.length > MEMBER_SLUG_MAX_CHARS) {
    slug = slug.slice(0, MEMBER_SLUG_MAX_CHARS).replaceAll(/[-_]+$/g, "");
  }

  return isValidMemberSlug(slug) ? slug : null;
};

/**
 * Derive a human profile filename stem from a git email local-part.
 * Example: `julius@example.com` → `julius`.
 */
export const slugFromGitEmail = (email: string): string | null => {
  const trimmed = email.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const at = trimmed.indexOf("@");
  const localPart = at === -1 ? trimmed : trimmed.slice(0, at);
  return slugifyMemberStem(localPart);
};

/**
 * Derive an agent profile filename stem from a display name.
 * Example: `Aria` → `aria`, `Code Reviewer` → `code-reviewer`.
 */
export const slugFromAgentName = (name: string): string | null => slugifyMemberStem(name);

/**
 * Pick a unique slug given already-used stems (filenames without `.json`).
 * First collision becomes `base-2`, then `base-3`, …
 */
export const disambiguateSlug = (base: string, existing: ReadonlySet<string>): string | null => {
  if (!isValidMemberSlug(base)) {
    return null;
  }
  if (!existing.has(base)) {
    return base;
  }

  for (let n = 2; n < 10_000; n += 1) {
    const suffix = `-${n}`;
    const maxBaseLen = MEMBER_SLUG_MAX_CHARS - suffix.length;
    if (maxBaseLen < 1) {
      return null;
    }
    const candidate = `${base.slice(0, maxBaseLen)}${suffix}`;
    if (isValidMemberSlug(candidate) && !existing.has(candidate)) {
      return candidate;
    }
  }

  return null;
};

/** Strip a trailing `.json` from a profile filename, if present. */
export const profileSlugFromFileName = (fileName: string): string | null => {
  const base = fileName.endsWith(".json") ? fileName.slice(0, -".json".length) : fileName;
  return isValidMemberSlug(base) ? base : null;
};

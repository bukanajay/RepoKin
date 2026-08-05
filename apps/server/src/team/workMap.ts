/**
 * Pure work-map projection (R3). Coarse directory activity → treemap nodes +
 * overlap radar. No I/O, no Effect — safe to unit-test and reuse on the client
 * if a surface ever needs the same projection.
 *
 * PRD FR-14.1–14.3 / implementation plan R3.1–R3.2.
 */

export interface WorkSignalInput {
  readonly memberId: string;
  readonly directories: readonly string[];
  /** Optional weight boost (e.g. number of touched files before coarsening). */
  readonly weight?: number;
}

export interface WorkMapNode {
  readonly path: string;
  readonly label: string;
  readonly weight: number;
  readonly memberIds: readonly string[];
}

export interface WorkMapOverlap {
  readonly path: string;
  readonly memberIds: readonly string[];
  readonly note: string;
}

/** Max directory depth we publish/display (repo root = 0). Deeper paths fold up. */
export const WORK_SIGNAL_MAX_DEPTH = 4;

/**
 * Coarsen a repo-relative file or directory path to a directory at most
 * `maxDepth` segments deep. Never returns file contents — only directory
 * prefixes (FR-14.1 / FR-14.4). Empty / `.` / absolute-looking paths are
 * dropped (return null).
 */
export function coarsenToDirectory(
  rawPath: string,
  maxDepth: number = WORK_SIGNAL_MAX_DEPTH,
): string | null {
  const normalized = rawPath
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized.includes("..")
  ) {
    return null;
  }

  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;

  // If the last segment looks like a file (has a dot and isn't a leading-dot
  // dir like `.github`), drop it so we only share directories.
  const last = segments[segments.length - 1]!;
  const looksLikeFile = last.includes(".") && !last.startsWith(".");
  const directorySegments = looksLikeFile ? segments.slice(0, -1) : segments;
  if (directorySegments.length === 0) {
    // File at repo root → no directory signal (too coarse / noisy).
    return null;
  }

  const capped = directorySegments.slice(0, Math.max(1, maxDepth));
  return capped.join("/");
}

/** Unique coarsened directories from a list of file/dir paths. */
export function directoriesFromPaths(
  paths: ReadonlyArray<string>,
  maxDepth: number = WORK_SIGNAL_MAX_DEPTH,
): string[] {
  const seen = new Set<string>();
  for (const path of paths) {
    const directory = coarsenToDirectory(path, maxDepth);
    if (directory !== null) seen.add(directory);
  }
  return [...seen].sort((left, right) => left.localeCompare(right));
}

function labelForPath(path: string): string {
  const segments = path.split("/");
  if (segments.length <= 2) return path;
  // Prefer a short trailing label so the treemap stays readable.
  return segments.slice(-2).join("/");
}

/**
 * Project member directory signals into treemap nodes. Weight is the number of
 * distinct members active there, scaled by optional per-signal weights so a
 * busy area grows (static layout — no continuous animation, NFR-2).
 */
export function projectWorkMapNodes(signals: ReadonlyArray<WorkSignalInput>): WorkMapNode[] {
  const byPath = new Map<string, { members: Set<string>; weight: number }>();

  for (const signal of signals) {
    const signalWeight = Math.max(1, signal.weight ?? (signal.directories.length || 1));
    for (const directory of signal.directories) {
      const path = coarsenToDirectory(directory) ?? directory;
      if (path.length === 0) continue;
      const entry = byPath.get(path) ?? { members: new Set<string>(), weight: 0 };
      entry.members.add(signal.memberId);
      entry.weight += signalWeight;
      byPath.set(path, entry);
    }
  }

  return [...byPath.entries()]
    .map(([path, entry]) => ({
      path,
      label: labelForPath(path),
      weight: entry.weight,
      memberIds: [...entry.members].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => right.weight - left.weight || left.path.localeCompare(right.path));
}

/**
 * Overlap radar: any directory with ≥2 distinct members is an overlap
 * (FR-14.3). Advisory only — no locking (FR-14.5).
 */
export function detectOverlaps(signals: ReadonlyArray<WorkSignalInput>): WorkMapOverlap[] {
  const byPath = new Map<string, Set<string>>();

  for (const signal of signals) {
    for (const directory of signal.directories) {
      const path = coarsenToDirectory(directory) ?? directory;
      if (path.length === 0) continue;
      const members = byPath.get(path) ?? new Set<string>();
      members.add(signal.memberId);
      byPath.set(path, members);
    }
  }

  const overlaps: WorkMapOverlap[] = [];
  for (const [path, members] of byPath) {
    if (members.size < 2) continue;
    const memberIds = [...members].sort((left, right) => left.localeCompare(right));
    overlaps.push({
      path,
      memberIds,
      note: formatOverlapNote(path, memberIds),
    });
  }
  return overlaps.sort((left, right) => left.path.localeCompare(right.path));
}

function formatOverlapNote(path: string, memberIds: readonly string[]): string {
  if (memberIds.length === 2) {
    return `${memberIds[0]} and ${memberIds[1]} are both working in \`${path}\`.`;
  }
  return `${memberIds.length} members are working in \`${path}\`.`;
}

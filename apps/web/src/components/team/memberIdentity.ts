/**
 * Pure identity helpers for Team space primitives: deterministic accent
 * colors, initials, and agent identicon geometry. No React, no DOM — shared
 * by the roster UI and the composer agent picker.
 */

/**
 * Accent palette for members without an explicit `avatar.accentColor`.
 * Mirrored in `theme.css` as `--team-accent-*`; keep the two lists in sync.
 */
export const TEAM_ACCENT_PALETTE = [
  "#7c5cff", // violet
  "#3b82f6", // blue
  "#06b6d4", // cyan
  "#14b8a6", // teal
  "#22c55e", // green
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#d946ef", // fuchsia
] as const;

/** FNV-1a 32-bit — stable across sessions and platforms. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Accent color for a member. An explicit profile color always wins; otherwise
 * the member id hashes to a stable palette entry.
 */
export function deriveMemberAccentColor(
  memberId: string,
  explicitColor?: string | undefined,
): string {
  const explicit = explicitColor?.trim();
  if (explicit !== undefined && explicit.length > 0) return explicit;
  return TEAM_ACCENT_PALETTE[fnv1a(memberId) % TEAM_ACCENT_PALETTE.length]!;
}

/** Up to two initials from a display name ("Ada Lovelace" → "AL"). */
export function memberInitials(displayName: string): string {
  const words = displayName
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return "?";
  const first = words[0]![0]!;
  const second = words.length > 1 ? words[words.length - 1]![0]! : "";
  return (first + second).toUpperCase();
}

export const IDENTICON_GRID_SIZE = 5;

/**
 * 5×5 horizontally symmetric cell grid for an agent identicon, derived from
 * the member id. Row-major booleans; true cells are painted in the on-accent
 * foreground. Deterministic: same id, same glyph, on every machine.
 */
export function identiconCells(memberId: string): boolean[] {
  const half = Math.ceil(IDENTICON_GRID_SIZE / 2);
  const cells: boolean[] = new Array(IDENTICON_GRID_SIZE * IDENTICON_GRID_SIZE).fill(false);
  // Two independent hash streams so 25 cells draw from 64 bits of state.
  const hashA = fnv1a(memberId);
  const hashB = fnv1a(`${memberId}:identicon`);
  for (let row = 0; row < IDENTICON_GRID_SIZE; row++) {
    for (let column = 0; column < half; column++) {
      const bitIndex = row * half + column;
      const bit = bitIndex < 32 ? (hashA >>> bitIndex) & 1 : (hashB >>> (bitIndex - 32)) & 1;
      if (bit === 1) {
        cells[row * IDENTICON_GRID_SIZE + column] = true;
        cells[row * IDENTICON_GRID_SIZE + (IDENTICON_GRID_SIZE - 1 - column)] = true;
      }
    }
  }
  // Never render an empty glyph: guarantee the center cell for degenerate hashes.
  if (!cells.some(Boolean)) {
    const center = Math.floor(IDENTICON_GRID_SIZE / 2);
    cells[center * IDENTICON_GRID_SIZE + center] = true;
  }
  return cells;
}

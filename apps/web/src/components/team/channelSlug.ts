import { ChannelId } from "@t3tools/contracts/team";
import * as Schema from "effect/Schema";

const isChannelId = Schema.is(ChannelId);

/**
 * Derive a channel slug from a free-text display name, matching the member-slug
 * rule the contract enforces (`^[a-zA-Z][a-zA-Z0-9_-]*$`, ≤64 chars). Lowercase,
 * non-slug characters collapse to hyphens, and any leading run without a letter
 * is dropped so the result always starts with a letter. Returns `""` when the
 * name has no usable letters — callers must treat that as "needs a manual slug".
 */
export function deriveChannelSlug(name: string): string {
  const collapsed = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  // Drop any leading characters until the first letter (slug must be letter-first).
  const letterFirst = collapsed.replace(/^[^a-z]+/, "");
  return letterFirst.slice(0, 64);
}

/** `null` when the slug is a valid `ChannelId`, otherwise a short reason. */
export function channelSlugError(slug: string): string | null {
  if (slug.trim().length === 0) return "Enter a channel id.";
  return isChannelId(slug)
    ? null
    : "Use a letter-first id with letters, digits, hyphens, or underscores.";
}

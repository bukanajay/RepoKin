import { describe, expect, it } from "vite-plus/test";

import {
  IDENTICON_GRID_SIZE,
  TEAM_ACCENT_PALETTE,
  deriveMemberAccentColor,
  identiconCells,
  memberInitials,
} from "./memberIdentity";

describe("deriveMemberAccentColor", () => {
  it("is deterministic per member id", () => {
    expect(deriveMemberAccentColor("agent_aria")).toBe(deriveMemberAccentColor("agent_aria"));
  });

  it("draws from the shared palette", () => {
    expect(TEAM_ACCENT_PALETTE).toContain(deriveMemberAccentColor("agent_aria"));
    expect(TEAM_ACCENT_PALETTE).toContain(deriveMemberAccentColor("human_local"));
  });

  it("prefers an explicit profile color", () => {
    expect(deriveMemberAccentColor("agent_aria", "#123456")).toBe("#123456");
    expect(deriveMemberAccentColor("agent_aria", "  ")).toBe(deriveMemberAccentColor("agent_aria"));
  });

  it("spreads distinct ids across the palette", () => {
    const colors = new Set(
      ["agent_aria", "agent_bolt", "agent_clio", "human_ajay", "human_sam", "agent_nova"].map(
        (id) => deriveMemberAccentColor(id),
      ),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe("memberInitials", () => {
  it("uses first and last word initials", () => {
    expect(memberInitials("Ada Lovelace")).toBe("AL");
    expect(memberInitials("Ada Byron Lovelace")).toBe("AL");
  });

  it("uses a single initial for one-word names", () => {
    expect(memberInitials("Aria")).toBe("A");
  });

  it("falls back for empty names", () => {
    expect(memberInitials("   ")).toBe("?");
  });
});

describe("identiconCells", () => {
  it("is deterministic and grid-sized", () => {
    const cells = identiconCells("agent_aria");
    expect(cells).toHaveLength(IDENTICON_GRID_SIZE * IDENTICON_GRID_SIZE);
    expect(cells).toEqual(identiconCells("agent_aria"));
  });

  it("is horizontally symmetric", () => {
    const cells = identiconCells("agent_bolt");
    for (let row = 0; row < IDENTICON_GRID_SIZE; row++) {
      for (let column = 0; column < IDENTICON_GRID_SIZE; column++) {
        expect(cells[row * IDENTICON_GRID_SIZE + column]).toBe(
          cells[row * IDENTICON_GRID_SIZE + (IDENTICON_GRID_SIZE - 1 - column)],
        );
      }
    }
  });

  it("differs across members and is never empty", () => {
    const a = identiconCells("agent_aria");
    const b = identiconCells("agent_bolt");
    expect(a).not.toEqual(b);
    expect(a.some(Boolean)).toBe(true);
  });
});

/**
 * Repo pulse (FR-19.1): contribution + hot spots from local Git history,
 * split human vs agent using RepoKin-Agent trailers and roster emails.
 */
import type {
  TeamRepoPulseContributor,
  TeamRepoPulseHotspot,
  TeamRepoPulseReadResult,
  TeamRosterReadModel,
} from "@t3tools/contracts/team";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import * as ProcessRunner from "../processRunner.ts";
import { directoriesFromPaths } from "./workMap.ts";

export interface ParsedPulseCommit {
  readonly hash: string;
  readonly authorEmail: string;
  readonly agentId: string | null;
  readonly paths: readonly string[];
  readonly additions: number;
  readonly deletions: number;
}

/**
 * Parse `git log --numstat` style output with a custom format prefix line:
 *   COMMIT <hash> <email>
 *   TRAILER <agentId>   (optional)
 *   <add>\t<del>\t<path>
 */
export function parseGitNumstatLog(stdout: string): ParsedPulseCommit[] {
  const commits: ParsedPulseCommit[] = [];
  let current: {
    hash: string;
    authorEmail: string;
    agentId: string | null;
    paths: string[];
    additions: number;
    deletions: number;
  } | null = null;

  const flush = () => {
    if (current !== null) {
      commits.push({ ...current, paths: [...current.paths] });
      current = null;
    }
  };

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith("COMMIT ")) {
      flush();
      const parts = line.slice("COMMIT ".length).split("\t");
      current = {
        hash: parts[0] ?? "",
        authorEmail: (parts[1] ?? "").toLowerCase(),
        agentId: null,
        paths: [],
        additions: 0,
        deletions: 0,
      };
      continue;
    }
    if (current === null) continue;
    if (line.startsWith("TRAILER ")) {
      const agent = line.slice("TRAILER ".length).trim();
      if (agent.length > 0) current.agentId = agent;
      continue;
    }
    // numstat: additions \t deletions \t path
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (match === null) continue;
    const add = match[1] === "-" ? 0 : Number(match[1]);
    const del = match[2] === "-" ? 0 : Number(match[2]);
    const filePath = match[3] ?? "";
    if (filePath.length === 0) continue;
    current.additions += add;
    current.deletions += del;
    current.paths.push(filePath);
  }
  flush();
  return commits;
}

export function projectRepoPulse(input: {
  readonly commits: ReadonlyArray<ParsedPulseCommit>;
  readonly roster: TeamRosterReadModel;
  readonly since: string;
  readonly until: string;
}): TeamRepoPulseReadResult {
  const emailToHuman = new Map<string, string>();
  for (const human of input.roster.humans) {
    for (const email of human.gitEmails) {
      emailToHuman.set(email.toLowerCase(), human.id);
    }
  }

  type Bucket = {
    id: string;
    kind: "human" | "agent" | "unknown";
    commits: number;
    additions: number;
    deletions: number;
  };
  const byId = new Map<string, Bucket>();

  const touch = (key: string, kind: Bucket["kind"], additions: number, deletions: number) => {
    const existing = byId.get(key) ?? {
      id: key,
      kind,
      commits: 0,
      additions: 0,
      deletions: 0,
    };
    existing.commits += 1;
    existing.additions += additions;
    existing.deletions += deletions;
    byId.set(key, existing);
  };

  const hotspotCounts = new Map<string, { touches: number; human: number; agent: number }>();

  for (const commit of input.commits) {
    let kind: Bucket["kind"] = "unknown";
    let id = commit.authorEmail || "unknown";
    if (commit.agentId !== null) {
      kind = "agent";
      id = commit.agentId;
    } else {
      const humanId = emailToHuman.get(commit.authorEmail);
      if (humanId !== undefined) {
        kind = "human";
        id = humanId;
      }
    }
    touch(id, kind, commit.additions, commit.deletions);

    for (const directory of directoriesFromPaths(commit.paths)) {
      const entry = hotspotCounts.get(directory) ?? { touches: 0, human: 0, agent: 0 };
      entry.touches += 1;
      if (kind === "human") entry.human += 1;
      if (kind === "agent") entry.agent += 1;
      hotspotCounts.set(directory, entry);
    }
  }

  const contributors = [...byId.values()];
  const toContributor = (bucket: Bucket): TeamRepoPulseContributor => ({
    id: bucket.id,
    kind: bucket.kind,
    commits: bucket.commits,
    additions: bucket.additions,
    deletions: bucket.deletions,
  });

  const hotspots: TeamRepoPulseHotspot[] = [...hotspotCounts.entries()]
    .map(([path, stats]) => ({
      path,
      touches: stats.touches,
      humanTouches: stats.human,
      agentTouches: stats.agent,
    }))
    .sort((left, right) => right.touches - left.touches || left.path.localeCompare(right.path))
    .slice(0, 40);

  return {
    since: input.since,
    until: input.until,
    humans: contributors.filter((c) => c.kind === "human").map(toContributor),
    agents: contributors.filter((c) => c.kind === "agent").map(toContributor),
    unknown: contributors.filter((c) => c.kind === "unknown").map(toContributor),
    hotspots,
    totalCommits: input.commits.length,
  };
}

export const readRepoPulse = Effect.fn("TeamRepoPulse.read")(function* (input: {
  readonly cwd: string;
  readonly days: number;
  readonly roster: TeamRosterReadModel;
}) {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const until = yield* DateTime.now;
  const since = DateTime.add(until, { days: -input.days });
  const sinceIso = DateTime.formatIso(since);
  const untilIso = DateTime.formatIso(until);

  // Format: COMMIT hash \t email \n TRAILER agent \n numstat lines
  const result = yield* processRunner
    .run({
      command: "git",
      args: [
        "-C",
        input.cwd,
        "log",
        `--since=${sinceIso}`,
        "--pretty=format:COMMIT %H%x09%ae%n%(trailers:key=RepoKin-Agent,valueonly,separator=%x0a)",
        "--numstat",
      ],
      timeoutBehavior: "timedOutResult",
    })
    .pipe(Effect.option);

  if (result._tag === "None" || result.value.code !== 0) {
    return projectRepoPulse({
      commits: [],
      roster: input.roster,
      since: sinceIso,
      until: untilIso,
    });
  }

  // Normalize trailer lines: empty trailer still emits a blank after COMMIT.
  // Our parser treats TRAILER lines; convert non-empty post-COMMIT lines that
  // are not numstat into TRAILER when they look like agent ids.
  const normalized = result.value.stdout
    .split(/\r?\n/)
    .map((line) => {
      if (line.startsWith("COMMIT ") || /^\d+|-\t/.test(line) || line.length === 0) {
        return line;
      }
      if (line.startsWith("TRAILER ")) return line;
      // git %(trailers) may emit the raw agent id without a prefix
      if (/^(agent_|human_)/.test(line.trim())) {
        return `TRAILER ${line.trim()}`;
      }
      return line;
    })
    .join("\n");

  const commits = parseGitNumstatLog(normalized);
  return projectRepoPulse({
    commits,
    roster: input.roster,
    since: sinceIso,
    until: untilIso,
  });
});

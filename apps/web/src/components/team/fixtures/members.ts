/**
 * Member summaries used by fixture surfaces only. Live surfaces resolve
 * members from the roster; fixture posts/tasks reference these ids.
 * Dies with the last fixture flip.
 */

export type FixtureMember = {
  memberId: string;
  displayName: string;
  memberType: "human" | "agent";
};

export const FIXTURE_MEMBERS: readonly FixtureMember[] = [
  { memberId: "human_ajay", displayName: "Ajay", memberType: "human" },
  { memberId: "human_sam", displayName: "Sam", memberType: "human" },
  { memberId: "agent_aria", displayName: "Aria", memberType: "agent" },
  { memberId: "agent_bolt", displayName: "Bolt", memberType: "agent" },
];

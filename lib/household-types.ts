import type { Group, Scope, Task } from "./task-tracker-types";

// A household is a small shared space (a family). Private lists keep living
// under users/{uid}; household lists and tasks live under households/{id}.
export const MAX_HOUSEHOLD_MEMBERS = 3;
// The owner is a member too, so they can invite at most this many others.
export const MAX_INVITEES = MAX_HOUSEHOLD_MEMBERS - 1;

export type Household = {
  id: string;
  name: string;
  ownerId: string;
  invitedEmails: string[];
};

export type HouseholdMember = {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
};

export type HouseholdInvite = {
  // Lowercased invitee email; also the invite document id.
  email: string;
  householdId: string;
  householdName: string;
  invitedBy: string;
};

export type SharedGroup = Group & { createdBy: string };

export type SharedTask = Task & {
  assigneeId: string | null;
  createdBy: string;
  completedBy: string | null;
};

export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

const EMAIL_PATTERN = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;

// Turns free text ("a@x.com, b@y.com") into the invite list: lowercased,
// de-duplicated, without the owner's own address. Malformed entries are
// reported separately, and tooMany is set when the list would push the
// household past MAX_HOUSEHOLD_MEMBERS.
export const parseInviteEmails = (
  raw: string,
  ownEmail: string,
): { emails: string[]; invalid: string[]; tooMany: boolean } => {
  const own = normalizeEmail(ownEmail);
  const seen = new Set<string>();
  const emails: string[] = [];
  const invalid: string[] = [];

  raw
    .split(/[\s,;]+/)
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean)
    .forEach((email) => {
      if (!EMAIL_PATTERN.test(email)) {
        if (!invalid.includes(email)) invalid.push(email);
        return;
      }
      if (email === own || seen.has(email)) return;
      seen.add(email);
      emails.push(email);
    });

  return { emails, invalid, tooMany: emails.length > MAX_INVITEES };
};

// Name to show for a member: their display name, else the part of their
// email before the @.
export const memberLabel = (member: {
  displayName: string;
  email: string;
}): string =>
  member.displayName.trim() || member.email.split("@")[0] || "Member";

// How many more people the owner can still invite. Accepted invites stay in
// invitedEmails, so its length is the number of seats already spoken for.
export const inviteSlotsLeft = (invitedEmails: string[]): number =>
  Math.max(0, MAX_INVITEES - invitedEmails.length);

// Items saved before households existed have no scope and are private.
export const scopeOf = (item: { scope?: Scope }): Scope => item.scope ?? "private";

export const splitGroupsByScope = (
  groups: Group[],
): { household: Group[]; private: Group[] } => ({
  household: groups.filter((group) => scopeOf(group) === "household"),
  private: groups.filter((group) => scopeOf(group) === "private"),
});

// Only the person who created a household list can delete it (the rules
// enforce this too). Private lists are always the owner's to delete.
export const canDeleteGroup = (group: Group, userId: string): boolean =>
  scopeOf(group) === "private" || group.createdBy === userId;

// A private list can be shared when the person is in a household, but their
// last private list stays put so they always keep somewhere private. A
// household list can be made private only by whoever created it.
export const canMoveGroup = (
  group: Group,
  context: { userId: string; hasHousehold: boolean; privateGroupCount: number },
): boolean =>
  scopeOf(group) === "private"
    ? context.hasHousehold && context.privateGroupCount > 1
    : group.createdBy === context.userId;

// Splits task ids by where each task lives, so deletes go to the right space.
export const taskIdsByScope = (
  tasks: Task[],
  ids: string[],
): Record<Scope, string[]> => {
  const wanted = new Set(ids);
  const result: Record<Scope, string[]> = { private: [], household: [] };
  tasks.forEach((task) => {
    if (wanted.has(task.id)) result[scopeOf(task)].push(task.id);
  });
  return result;
};

export type AssigneeFilter = "all" | "mine" | "unassigned";

// Private tasks are always yours; household tasks are yours when assigned to
// you, and "unassigned" means a household task nobody has claimed.
export const matchesAssigneeFilter = (
  task: Task,
  filter: AssigneeFilter,
  userId: string,
): boolean => {
  if (filter === "all") return true;
  const shared = scopeOf(task) === "household";
  if (filter === "mine") return !shared || task.assigneeId === userId;
  return shared && !task.assigneeId;
};

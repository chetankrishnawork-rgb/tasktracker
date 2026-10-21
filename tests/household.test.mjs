import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAX_INVITEES,
  memberLabel,
  normalizeEmail,
  parseInviteEmails,
} from "../lib/household-types.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("normalizeEmail trims and lowercases", () => {
  assert.equal(normalizeEmail("  Sam.Smith@Gmail.COM "), "sam.smith@gmail.com");
});

test("parseInviteEmails: splits on commas, spaces, semicolons and newlines", () => {
  const result = parseInviteEmails("a@x.com, b@y.com\nc@z.com;d@w.com", "owner@x.com");
  assert.deepEqual(result.emails, ["a@x.com", "b@y.com", "c@z.com", "d@w.com"]);
});

test("parseInviteEmails: lowercases, de-duplicates and drops the owner", () => {
  const result = parseInviteEmails(
    "Sam@X.com, sam@x.com, OWNER@x.com, kid@x.com",
    "owner@X.com",
  );
  assert.deepEqual(result.emails, ["sam@x.com", "kid@x.com"]);
  assert.equal(result.tooMany, false);
});

test("parseInviteEmails: reports malformed addresses", () => {
  const result = parseInviteEmails("not-an-email, ok@x.com, a@b", "owner@x.com");
  assert.deepEqual(result.emails, ["ok@x.com"]);
  assert.deepEqual(result.invalid, ["not-an-email", "a@b"]);
});

test("parseInviteEmails: flags more invitees than the household can hold", () => {
  assert.equal(MAX_INVITEES, 2);
  const result = parseInviteEmails("a@x.com b@x.com c@x.com", "owner@x.com");
  assert.equal(result.tooMany, true);
  assert.equal(parseInviteEmails("a@x.com b@x.com", "owner@x.com").tooMany, false);
});

test("parseInviteEmails: empty input gives an empty list", () => {
  assert.deepEqual(parseInviteEmails("  ", "owner@x.com"), {
    emails: [],
    invalid: [],
    tooMany: false,
  });
});

test("memberLabel prefers the display name, then the email name", () => {
  assert.equal(memberLabel({ displayName: "Priya", email: "p@x.com" }), "Priya");
  assert.equal(memberLabel({ displayName: " ", email: "sam@x.com" }), "sam");
});

test("private data stays owner-only and household data is member-only", async () => {
  const rules = await read("firestore.rules");
  assert.match(rules, /match \/users\/\{userId\}/);
  assert.match(rules, /match \/households\/\{householdId\}/);
  assert.match(rules, /function isMember\(householdId\)/);
  assert.doesNotMatch(rules, /allow read, write:\s*if true/);
  assert.doesNotMatch(rules, /allow (read|list|get):\s*if true/);
});

test("household rules require a verified email and block invite listing", async () => {
  const rules = await read("firestore.rules");
  assert.match(rules, /request\.auth\.token\.email_verified == true/);
  assert.match(rules, /match \/householdInvites\/\{inviteId\}/);
  assert.match(rules, /allow get: if verifiedEmail\(\) && inviteId == myEmail\(\)/);
  assert.doesNotMatch(rules, /allow list/);
});

test("household rules cap invites at two and shared tasks track assignment", async () => {
  const rules = await read("firestore.rules");
  assert.match(rules, /invitedEmails\.size\(\) <= 2/);
  assert.match(rules, /'assigneeId', 'createdBy', 'completedBy'/);
});

test("inviteSlotsLeft counts seats still open for invitations", async () => {
  const { inviteSlotsLeft } = await import("../lib/household-types.ts");
  assert.equal(inviteSlotsLeft([]), 2);
  assert.equal(inviteSlotsLeft(["a@x.com"]), 1);
  assert.equal(inviteSlotsLeft(["a@x.com", "b@x.com"]), 0);
  assert.equal(inviteSlotsLeft(["a@x.com", "b@x.com", "c@x.com"]), 0);
});

test("the app wires in the household panel with setup, join and invite flows", async () => {
  const [app, panel] = await Promise.all([
    read("app/task-tracker-app.tsx"),
    read("app/household-panel.tsx"),
  ]);
  assert.match(app, /<HouseholdPanel db=\{db\} user=\{user\} state=\{household\} \/>/);
  assert.match(panel, /createHousehold\(db, user, name, parsed\.emails\)/);
  assert.match(panel, /acceptHouseholdInvite\(db, user, invite\)/);
  assert.match(panel, /inviteToHousehold\(db, user, household, fresh\)/);
});

test("scopeOf treats items without a scope as private", async () => {
  const { scopeOf } = await import("../lib/household-types.ts");
  assert.equal(scopeOf({}), "private");
  assert.equal(scopeOf({ scope: "private" }), "private");
  assert.equal(scopeOf({ scope: "household" }), "household");
});

test("splitGroupsByScope separates household and private lists", async () => {
  const { splitGroupsByScope } = await import("../lib/household-types.ts");
  const groups = [
    { id: "a", name: "A", color: "#586A5B", scope: "private" },
    { id: "b", name: "B", color: "#586A5B", scope: "household", createdBy: "u1" },
    { id: "c", name: "C", color: "#586A5B" },
  ];
  const split = splitGroupsByScope(groups);
  assert.deepEqual(split.household.map((g) => g.id), ["b"]);
  assert.deepEqual(split.private.map((g) => g.id), ["a", "c"]);
});

test("canDeleteGroup: private lists are always deletable, household lists only by their creator", async () => {
  const { canDeleteGroup } = await import("../lib/household-types.ts");
  const mine = { id: "a", name: "A", color: "#586A5B", scope: "household", createdBy: "u1" };
  assert.equal(canDeleteGroup({ ...mine, scope: "private" }, "u2"), true);
  assert.equal(canDeleteGroup(mine, "u1"), true);
  assert.equal(canDeleteGroup(mine, "u2"), false);
});

test("canMoveGroup: sharing needs a household and keeps one private list; making private needs the creator", async () => {
  const { canMoveGroup } = await import("../lib/household-types.ts");
  const priv = { id: "a", name: "A", color: "#586A5B", scope: "private" };
  const shared = { id: "b", name: "B", color: "#586A5B", scope: "household", createdBy: "u1" };
  assert.equal(canMoveGroup(priv, { userId: "u1", hasHousehold: true, privateGroupCount: 2 }), true);
  assert.equal(canMoveGroup(priv, { userId: "u1", hasHousehold: false, privateGroupCount: 2 }), false);
  assert.equal(canMoveGroup(priv, { userId: "u1", hasHousehold: true, privateGroupCount: 1 }), false);
  assert.equal(canMoveGroup(shared, { userId: "u1", hasHousehold: true, privateGroupCount: 1 }), true);
  assert.equal(canMoveGroup(shared, { userId: "u2", hasHousehold: true, privateGroupCount: 3 }), false);
});

test("taskIdsByScope routes ids to the space each task lives in", async () => {
  const { taskIdsByScope } = await import("../lib/household-types.ts");
  const base = {
    title: "T", groupId: "g", priority: "Medium", dueDate: "", completed: false,
    completedAt: null, createdAt: "", subtasks: [], seriesId: null,
  };
  const tasks = [
    { ...base, id: "1", scope: "private" },
    { ...base, id: "2", scope: "household" },
    { ...base, id: "3" },
    { ...base, id: "4", scope: "household" },
  ];
  assert.deepEqual(taskIdsByScope(tasks, ["1", "2", "3", "9"]), {
    private: ["1", "3"],
    household: ["2"],
  });
});

test("writes go to the space the list or task lives in", async () => {
  const [app, repo] = await Promise.all([
    read("app/task-tracker-app.tsx"),
    read("lib/task-tracker-repository.ts"),
  ]);
  assert.match(app, /createTasks\(db, spaceFor\(scopeOfGroup\(activeGroupId\)\)/);
  assert.match(app, /setTaskCompleted\(db, spaceFor\(scopeOf\(task\)\), task\)/);
  assert.match(app, /subscribeToSharedSpace\(db, householdId/);
  assert.match(repo, /collection\(db, "households", space\.householdId, name\)/);
  assert.match(repo, /createdBy: space\.userId/);
});

test("moving a list copies everything before removing the originals", async () => {
  const repo = await read("lib/task-tracker-repository.ts");
  const copy = repo.indexOf("commitInChunks(db, copies)");
  const remove = repo.indexOf("commitInChunks(db, removals)");
  assert.ok(copy > 0 && remove > copy);
});

test("matchesAssigneeFilter: Mine includes private tasks and tasks assigned to you", async () => {
  const { matchesAssigneeFilter } = await import("../lib/household-types.ts");
  const base = {
    id: "1", title: "T", groupId: "g", priority: "Medium", dueDate: "", completed: false,
    completedAt: null, createdAt: "", subtasks: [], seriesId: null,
  };
  const privateTask = { ...base, scope: "private" };
  const mine = { ...base, scope: "household", assigneeId: "u1" };
  const theirs = { ...base, scope: "household", assigneeId: "u2" };
  const open = { ...base, scope: "household", assigneeId: null };

  assert.deepEqual([privateTask, mine, theirs, open].map((t) => matchesAssigneeFilter(t, "all", "u1")), [true, true, true, true]);
  assert.deepEqual([privateTask, mine, theirs, open].map((t) => matchesAssigneeFilter(t, "mine", "u1")), [true, true, false, false]);
  assert.deepEqual([privateTask, mine, theirs, open].map((t) => matchesAssigneeFilter(t, "unassigned", "u1")), [false, false, false, true]);
});

test("assignment is wired through the app and repository", async () => {
  const [app, repo] = await Promise.all([
    read("app/task-tracker-app.tsx"),
    read("lib/task-tracker-repository.ts"),
  ]);
  assert.match(app, /setTaskAssignee\(db, spaceFor\("household"\), task\.id, value \|\| null\)/);
  assert.match(app, /assigneeId,\n\s+\}\);/);
  assert.match(app, /aria-label="Filter by who it is for"/);
  assert.match(repo, /completedBy: task\.completed \? null : space\.userId/);
  assert.match(repo, /assigneeFields\(space, details\.assigneeId\)/);
});

test("rules allow assignee and completedBy only on household tasks", async () => {
  const rules = await read("firestore.rules");
  const [userTask] = rules.split("function validHousehold()");
  assert.doesNotMatch(userTask.slice(userTask.indexOf("function validTask()")), /assigneeId/);
  assert.match(rules, /'assigneeId', 'createdBy', 'completedBy'/);
});

const statsBase = {
  title: "T", groupId: "g", priority: "Medium", dueDate: "", completed: false,
  completedAt: null, createdAt: "", subtasks: [], seriesId: null,
};

test("tasksForPerson keeps private tasks and household tasks assigned to or completed by you", async () => {
  const { tasksForPerson } = await import("../lib/household-types.ts");
  const tasks = [
    { ...statsBase, id: "p", scope: "private" },
    { ...statsBase, id: "a", scope: "household", assigneeId: "u1" },
    { ...statsBase, id: "c", scope: "household", assigneeId: null, completedBy: "u1" },
    { ...statsBase, id: "o", scope: "household", assigneeId: "u2" },
    { ...statsBase, id: "n", scope: "household", assigneeId: null },
  ];
  assert.deepEqual(tasksForPerson(tasks, "u1").map((t) => t.id), ["p", "a", "c"]);
});

test("completedByPerson credits you only for what you finished", async () => {
  const { completedByPerson } = await import("../lib/household-types.ts");
  const done = { ...statsBase, completed: true, completedAt: "2026-10-20T10:00:00.000Z" };
  const tasks = [
    { ...done, id: "p", scope: "private" },
    { ...done, id: "mine", scope: "household", completedBy: "u1" },
    { ...done, id: "theirs", scope: "household", completedBy: "u2" },
    { ...done, id: "legacy", scope: "household", completedBy: null },
    { ...statsBase, id: "open", scope: "private" },
  ];
  assert.deepEqual(completedByPerson(tasks, "u1").map((t) => t.id), ["p", "mine"]);
});

test("householdOnly drops private tasks", async () => {
  const { householdOnly } = await import("../lib/household-types.ts");
  const tasks = [
    { ...statsBase, id: "p", scope: "private" },
    { ...statsBase, id: "h", scope: "household" },
    { ...statsBase, id: "x" },
  ];
  assert.deepEqual(householdOnly(tasks).map((t) => t.id), ["h"]);
});

test("completionsByMember counts each member's completions in the window", async () => {
  const { completionsByMember } = await import("../lib/household-types.ts");
  const done = (id, by, at) => ({
    ...statsBase, id, scope: "household", completed: true, completedBy: by, completedAt: at,
  });
  const tasks = [
    done("1", "u1", "2026-10-20T10:00:00.000Z"),
    done("2", "u1", "2026-10-14T10:00:00.000Z"),
    done("3", "u2", "2026-10-18T10:00:00.000Z"),
    done("4", "u2", "2026-10-13T10:00:00.000Z"), // before the 7-day window
    done("5", "u3", "2026-10-19T10:00:00.000Z"), // not a listed member
    { ...statsBase, id: "6", scope: "household", completed: false },
  ];
  assert.deepEqual(completionsByMember(tasks, ["u1", "u2"], 7, "2026-10-20"), [
    { uid: "u1", count: 2 },
    { uid: "u2", count: 1 },
  ]);
});

test("stats and notifications are scoped to the person", async () => {
  const app = await read("app/task-tracker-app.tsx");
  assert.match(app, /completedByPerson\(tasks, user\.uid\)/);
  assert.match(app, /matchesAssigneeFilter\(task, "mine", user\?\.uid \?\? ""\)/);
  assert.match(app, /aria-label="Whose stats"/);
});

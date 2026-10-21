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

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

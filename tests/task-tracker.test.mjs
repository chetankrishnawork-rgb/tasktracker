import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generateRecurringDates, subtaskSummary, tasksToCsv } from "../lib/task-tracker-types.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Firestore rules isolate each user's task data", async () => {
  const rules = await read("firestore.rules");
  assert.match(rules, /request\.auth\.uid == userId/);
  assert.match(rules, /match \/tasks\/\{taskId\}/);
  assert.match(rules, /validTask\(\)/);
  assert.doesNotMatch(rules, /allow read, write:\s*if true/);
});

test("firestore rules bound the optional subtasks field", async () => {
  const rules = await read("firestore.rules");
  assert.match(rules, /subtasks\.size\(\) <= 50/);
});

test("destructive actions require the confirmation dialog", async () => {
  const app = await read("app/task-tracker-app.tsx");
  assert.match(app, /role="alertdialog"/);
  assert.match(app, /Yes, delete/);
  assert.match(app, /setDeleteIds\(selected\)/);
  assert.match(app, /deleteTasks\(db, user\.uid, deleteIds\)/);
});

test("sign out requires confirmation", async () => {
  const app = await read("app/task-tracker-app.tsx");
  assert.match(app, /Sign out of Task Tracker\?/);
  assert.match(app, /confirmSignOutAndClose/);
});

test("the application includes PWA and migration support", async () => {
  const [manifest, worker, app] = await Promise.all([
    read("app/manifest.ts"),
    read("public/sw.js"),
    read("app/task-tracker-app.tsx"),
  ]);
  assert.match(manifest, /display: "standalone"/);
  assert.match(manifest, /icon-maskable-512\.png/);
  assert.match(worker, /task-tracker-shell-v1/);
  assert.match(app, /Import and sync/);
  assert.match(app, /serviceWorker/);
});

test("generateRecurringDates: single weekday returns itself", () => {
  // 2026-07-27 is a Monday
  assert.deepEqual(
    generateRecurringDates("2026-07-27", "2026-07-27", false),
    ["2026-07-27"],
  );
});

test("generateRecurringDates: excludes weekends by default", () => {
  // Fri 2026-07-24 through Mon 2026-07-27 spans a weekend
  const dates = generateRecurringDates("2026-07-24", "2026-07-27", false);
  assert.deepEqual(dates, ["2026-07-24", "2026-07-27"]);
});

test("generateRecurringDates: includes weekends when requested", () => {
  const dates = generateRecurringDates("2026-07-24", "2026-07-27", true);
  assert.deepEqual(dates, [
    "2026-07-24",
    "2026-07-25",
    "2026-07-26",
    "2026-07-27",
  ]);
});

test("generateRecurringDates: handles a leap day correctly", () => {
  // 2028 is a leap year; range spans Feb 28 -> Mar 1 inclusive of Feb 29
  const dates = generateRecurringDates("2028-02-28", "2028-03-01", true);
  assert.deepEqual(dates, ["2028-02-28", "2028-02-29", "2028-03-01"]);
});

test("generateRecurringDates: returns empty array for an inverted range", () => {
  assert.deepEqual(generateRecurringDates("2026-08-01", "2026-07-01", true), []);
});

test("generateRecurringDates: returns empty array for missing dates", () => {
  assert.deepEqual(generateRecurringDates("", "2026-07-27", true), []);
  assert.deepEqual(generateRecurringDates("2026-07-27", "", true), []);
});

test("tasksToCsv: resolves group names and formats rows", () => {
  const groups = [{ id: "work", name: "Work", color: "#586A5B" }];
  const tasks = [
    {
      id: "1",
      title: "Ship release",
      groupId: "work",
      priority: "High",
      dueDate: "2026-07-27",
      completed: false,
      completedAt: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      subtasks: [],
    },
  ];
  const csv = tasksToCsv(tasks, groups);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "Title,Group,Priority,Due date,Completed,Completed at");
  assert.equal(lines[1], "Ship release,Work,High,2026-07-27,No,");
});

test("tasksToCsv: escapes commas, quotes, and newlines", () => {
  const groups = [{ id: "work", name: "Work", color: "#586A5B" }];
  const tasks = [
    {
      id: "1",
      title: 'Call "the" client, then follow up\nwith notes',
      groupId: "work",
      priority: "Low",
      dueDate: "",
      completed: true,
      completedAt: "2026-07-27T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
      subtasks: [],
    },
  ];
  const csv = tasksToCsv(tasks, groups);
  assert.match(csv, /"Call ""the"" client, then follow up\nwith notes"/);
});

test("tasksToCsv: falls back to the raw id when a group no longer exists", () => {
  const csv = tasksToCsv(
    [
      {
        id: "1",
        title: "Orphaned task",
        groupId: "deleted-group",
        priority: "Medium",
        dueDate: "",
        completed: false,
        completedAt: null,
        createdAt: "2026-07-01T00:00:00.000Z",
        subtasks: [],
      },
    ],
    [],
  );
  assert.match(csv, /Orphaned task,deleted-group,Medium/);
});

const baseTask = {
  id: "1",
  title: "Task",
  groupId: "work",
  priority: "Medium",
  dueDate: "",
  completed: false,
  completedAt: null,
  createdAt: "2026-07-01T00:00:00.000Z",
};

test("subtaskSummary: counts done vs total", () => {
  const task = {
    ...baseTask,
    subtasks: [
      { id: "a", title: "One", completed: true },
      { id: "b", title: "Two", completed: false },
      { id: "c", title: "Three", completed: true },
    ],
  };
  assert.deepEqual(subtaskSummary(task), { done: 2, total: 3 });
});

test("subtaskSummary: zero subtasks returns zero/zero", () => {
  assert.deepEqual(subtaskSummary({ ...baseTask, subtasks: [] }), { done: 0, total: 0 });
});

test("subtaskSummary: all completed", () => {
  const task = {
    ...baseTask,
    subtasks: [
      { id: "a", title: "One", completed: true },
      { id: "b", title: "Two", completed: true },
    ],
  };
  assert.deepEqual(subtaskSummary(task), { done: 2, total: 2 });
});

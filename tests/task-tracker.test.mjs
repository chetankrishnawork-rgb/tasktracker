import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Firestore rules isolate each user's task data", async () => {
  const rules = await read("firestore.rules");
  assert.match(rules, /request\.auth\.uid == userId/);
  assert.match(rules, /match \/tasks\/\{taskId\}/);
  assert.match(rules, /validTask\(\)/);
  assert.doesNotMatch(rules, /allow read, write:\s*if true/);
});

test("destructive actions require the confirmation dialog", async () => {
  const app = await read("app/task-tracker-app.tsx");
  assert.match(app, /role="alertdialog"/);
  assert.match(app, /Yes, delete/);
  assert.match(app, /setDeleteIds\(selected\)/);
  assert.match(app, /deleteTasks\(db, user\.uid, deleteIds\)/);
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

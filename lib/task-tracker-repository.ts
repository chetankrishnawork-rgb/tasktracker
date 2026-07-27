import type { User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
  type QuerySnapshot,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import {
  defaultGroups,
  type Group,
  type PreviousTrackerData,
  type Priority,
  type Subtask,
  type Task,
} from "./task-tracker-types";

const toIso = (value: Timestamp | null | undefined) =>
  value?.toDate ? value.toDate().toISOString() : "";

const mapGroups = (snapshot: QuerySnapshot<DocumentData>): Group[] =>
  snapshot.docs.map((item) => ({
    id: item.id,
    name: String(item.data().name ?? "Untitled"),
    color: String(item.data().color ?? "#586A5B"),
  }));

const mapSubtasks = (value: unknown): Subtask[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => ({
          id: String(item.id ?? ""),
          title: String(item.title ?? ""),
          completed: Boolean(item.completed),
        }))
        .filter((subtask) => subtask.id && subtask.title)
    : [];

const mapTasks = (snapshot: QuerySnapshot<DocumentData>): Task[] =>
  snapshot.docs.map((item) => {
    const data = item.data();
    return {
      id: item.id,
      title: String(data.title ?? "Untitled task"),
      groupId: String(data.groupId ?? "work"),
      priority: (data.priority ?? "Medium") as Priority,
      dueDate: String(data.dueDate ?? ""),
      completed: Boolean(data.completed),
      completedAt: data.completedAt ? toIso(data.completedAt) : null,
      createdAt: toIso(data.createdAt),
      subtasks: mapSubtasks(data.subtasks),
    };
  });

export async function ensureWorkspace(db: Firestore, user: User) {
  const userRef = doc(db, "users", user.uid);
  const existingUser = await getDoc(userRef);
  await setDoc(
    userRef,
    {
      email: user.email ?? "",
      displayName: user.displayName ?? "",
      photoURL: user.photoURL ?? "",
      createdAt: existingUser.exists()
        ? existingUser.data().createdAt
        : serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  const groupCollection = collection(db, "users", user.uid, "groups");
  const existingGroups = await getDocs(groupCollection);
  if (!existingGroups.empty) return;

  const batch = writeBatch(db);
  defaultGroups.forEach((group) => {
    batch.set(doc(groupCollection, group.id), {
      name: group.name,
      color: group.color,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
}

export function subscribeToWorkspace(
  db: Firestore,
  userId: string,
  handlers: {
    onGroups: (groups: Group[], pending: boolean, cached: boolean) => void;
    onTasks: (tasks: Task[], pending: boolean, cached: boolean) => void;
    onError: (error: Error) => void;
  },
) {
  const unsubscribeGroups = onSnapshot(
    collection(db, "users", userId, "groups"),
    { includeMetadataChanges: true },
    (snapshot) =>
      handlers.onGroups(
        mapGroups(snapshot),
        snapshot.metadata.hasPendingWrites,
        snapshot.metadata.fromCache,
      ),
    handlers.onError,
  );

  const unsubscribeTasks = onSnapshot(
    collection(db, "users", userId, "tasks"),
    { includeMetadataChanges: true },
    (snapshot) =>
      handlers.onTasks(
        mapTasks(snapshot),
        snapshot.metadata.hasPendingWrites,
        snapshot.metadata.fromCache,
      ),
    handlers.onError,
  );

  return () => {
    unsubscribeGroups();
    unsubscribeTasks();
  };
}

export async function createGroup(
  db: Firestore,
  userId: string,
  group: Group,
) {
  await setDoc(doc(db, "users", userId, "groups", group.id), {
    name: group.name,
    color: group.color,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteGroup(
  db: Firestore,
  userId: string,
  groupId: string,
  reassignToGroupId: string,
  affectedTaskIds: string[],
) {
  for (let start = 0; start < affectedTaskIds.length; start += 400) {
    const batch = writeBatch(db);
    affectedTaskIds.slice(start, start + 400).forEach((taskId) => {
      batch.update(doc(db, "users", userId, "tasks", taskId), {
        groupId: reassignToGroupId,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }
  await deleteDoc(doc(db, "users", userId, "groups", groupId));
}

export async function createTasks(
  db: Firestore,
  userId: string,
  titles: string[],
  details: { groupId: string; priority: Priority; dueDate: string },
) {
  for (let start = 0; start < titles.length; start += 400) {
    const batch = writeBatch(db);
    titles.slice(start, start + 400).forEach((title) => {
      const taskRef = doc(collection(db, "users", userId, "tasks"));
      batch.set(taskRef, {
        title,
        groupId: details.groupId,
        priority: details.priority,
        dueDate: details.dueDate,
        completed: false,
        completedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }
}

// Creates one task per date for a recurring task series (e.g. every workday
// in a date range), all sharing the same title, group, and priority.
export async function createRecurringTasks(
  db: Firestore,
  userId: string,
  title: string,
  details: { groupId: string; priority: Priority; dates: string[] },
) {
  for (let start = 0; start < details.dates.length; start += 400) {
    const batch = writeBatch(db);
    details.dates.slice(start, start + 400).forEach((dueDate) => {
      const taskRef = doc(collection(db, "users", userId, "tasks"));
      batch.set(taskRef, {
        title,
        groupId: details.groupId,
        priority: details.priority,
        dueDate,
        completed: false,
        completedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }
}

export async function setTaskCompleted(
  db: Firestore,
  userId: string,
  task: Task,
) {
  await updateDoc(doc(db, "users", userId, "tasks", task.id), {
    completed: !task.completed,
    completedAt: task.completed ? null : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// Replaces a task's full subtask list. Callers compute the next array
// client-side (toggle/add/delete) and pass the whole thing, matching the
// pattern used elsewhere in this file.
export async function setTaskSubtasks(
  db: Firestore,
  userId: string,
  taskId: string,
  subtasks: Subtask[],
) {
  await updateDoc(doc(db, "users", userId, "tasks", taskId), {
    subtasks,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteTasks(
  db: Firestore,
  userId: string,
  ids: string[],
) {
  for (let start = 0; start < ids.length; start += 400) {
    const batch = writeBatch(db);
    ids.slice(start, start + 400).forEach((id) =>
      batch.delete(doc(db, "users", userId, "tasks", id)),
    );
    await batch.commit();
  }
}

export async function localMigrationComplete(
  db: Firestore,
  userId: string,
) {
  const migration = await getDoc(
    doc(db, "users", userId, "meta", "local-storage-v1"),
  );
  return migration.exists();
}

export async function importLegacyData(
  db: Firestore,
  userId: string,
  legacy: PreviousTrackerData,
) {
  const operations = [
    ...legacy.groups.map((group) => ({ type: "group" as const, group })),
    ...legacy.tasks.map((task) => ({ type: "task" as const, task })),
  ];

  for (let start = 0; start < operations.length; start += 400) {
    const batch = writeBatch(db);
    operations.slice(start, start + 400).forEach((operation) => {
      if (operation.type === "group") {
        batch.set(
          doc(db, "users", userId, "groups", operation.group.id),
          {
            name: operation.group.name,
            color: operation.group.color,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } else {
        const task = operation.task;
        batch.set(doc(db, "users", userId, "tasks", task.id), {
          title: task.title,
          groupId: task.groupId,
          priority: task.priority,
          dueDate: task.dueDate ?? "",
          completed: Boolean(task.completed),
          completedAt: task.completed ? serverTimestamp() : null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
    await batch.commit();
  }

  await setDoc(doc(db, "users", userId, "meta", "local-storage-v1"), {
    importedAt: serverTimestamp(),
    taskCount: legacy.tasks.length,
    groupCount: legacy.groups.length,
  });
}

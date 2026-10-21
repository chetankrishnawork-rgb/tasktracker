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
  Timestamp,
  type Firestore,
  type QuerySnapshot,
  type DocumentData,
  type WriteBatch,
} from "firebase/firestore";
import {
  defaultGroups,
  type Group,
  type PreviousTrackerData,
  type Priority,
  type Scope,
  type Space,
  type Subtask,
  type Task,
} from "./task-tracker-types";

const toIso = (value: Timestamp | null | undefined) =>
  value?.toDate ? value.toDate().toISOString() : "";

// Collection for a space: private data under the user, household data under
// the household.
const spaceCollection = (db: Firestore, space: Space, name: "groups" | "tasks") =>
  space.scope === "household"
    ? collection(db, "households", space.householdId, name)
    : collection(db, "users", space.userId, name);

const spaceDoc = (
  db: Firestore,
  space: Space,
  name: "groups" | "tasks",
  id: string,
) => doc(spaceCollection(db, space, name), id);

// Household documents also record who created them (the rules require it).
const creatorFields = (space: Space) =>
  space.scope === "household" ? { createdBy: space.userId } : {};

// Only household tasks can be assigned; private tasks have no assignee.
const assigneeFields = (space: Space, assigneeId: string | null | undefined) =>
  space.scope === "household" ? { assigneeId: assigneeId ?? null } : {};

export const mapGroups = (
  snapshot: QuerySnapshot<DocumentData>,
  scope: Scope = "private",
): Group[] =>
  snapshot.docs.map((item) => ({
    id: item.id,
    name: String(item.data().name ?? "Untitled"),
    color: String(item.data().color ?? "#586A5B"),
    scope,
    createdBy:
      typeof item.data().createdBy === "string" ? item.data().createdBy : undefined,
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

export const mapTasks = (
  snapshot: QuerySnapshot<DocumentData>,
  scope: Scope = "private",
): Task[] =>
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
      seriesId: data.seriesId ? String(data.seriesId) : null,
      scope,
      createdBy: typeof data.createdBy === "string" ? data.createdBy : undefined,
      assigneeId: typeof data.assigneeId === "string" ? data.assigneeId : null,
      completedBy: typeof data.completedBy === "string" ? data.completedBy : null,
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
  space: Space,
  group: Group,
) {
  await setDoc(spaceDoc(db, space, "groups", group.id), {
    name: group.name,
    color: group.color,
    ...creatorFields(space),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// Deletes a group, first moving its tasks into reassignToGroupId (which must
// be in the same space). A household group with no tasks needs no target.
export async function deleteGroup(
  db: Firestore,
  space: Space,
  groupId: string,
  reassignToGroupId: string | null,
  affectedTaskIds: string[],
) {
  if (reassignToGroupId) {
    for (let start = 0; start < affectedTaskIds.length; start += 400) {
      const batch = writeBatch(db);
      affectedTaskIds.slice(start, start + 400).forEach((taskId) => {
        batch.update(spaceDoc(db, space, "tasks", taskId), {
          groupId: reassignToGroupId,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }
  }
  await deleteDoc(spaceDoc(db, space, "groups", groupId));
}

export async function createTasks(
  db: Firestore,
  space: Space,
  titles: string[],
  details: {
    groupId: string;
    priority: Priority;
    dueDate: string;
    assigneeId?: string | null;
  },
) {
  for (let start = 0; start < titles.length; start += 400) {
    const batch = writeBatch(db);
    titles.slice(start, start + 400).forEach((title) => {
      const taskRef = doc(spaceCollection(db, space, "tasks"));
      batch.set(taskRef, {
        title,
        groupId: details.groupId,
        priority: details.priority,
        dueDate: details.dueDate,
        completed: false,
        completedAt: null,
        ...creatorFields(space),
        ...assigneeFields(space, details.assigneeId),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }
}

// Creates one task per date for a recurring task series (e.g. every workday
// in a date range), all sharing the same title, group, priority, and a
// generated seriesId so the whole set can later be bulk-edited or deleted
// together via updateSeriesTasks / deleteTasks.
export async function createRecurringTasks(
  db: Firestore,
  space: Space,
  title: string,
  details: {
    groupId: string;
    priority: Priority;
    dates: string[];
    assigneeId?: string | null;
  },
) {
  const seriesId = doc(spaceCollection(db, space, "tasks")).id;
  for (let start = 0; start < details.dates.length; start += 400) {
    const batch = writeBatch(db);
    details.dates.slice(start, start + 400).forEach((dueDate) => {
      const taskRef = doc(spaceCollection(db, space, "tasks"));
      batch.set(taskRef, {
        title,
        groupId: details.groupId,
        priority: details.priority,
        dueDate,
        completed: false,
        completedAt: null,
        seriesId,
        ...creatorFields(space),
        ...assigneeFields(space, details.assigneeId),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }
}

export async function setTaskCompleted(
  db: Firestore,
  space: Space,
  task: Task,
) {
  await updateDoc(spaceDoc(db, space, "tasks", task.id), {
    completed: !task.completed,
    completedAt: task.completed ? null : serverTimestamp(),
    ...(space.scope === "household"
      ? { completedBy: task.completed ? null : space.userId }
      : {}),
    updatedAt: serverTimestamp(),
  });
}

// Assigns a household task to a member, or to nobody (null).
export async function setTaskAssignee(
  db: Firestore,
  space: Space,
  taskId: string,
  assigneeId: string | null,
) {
  await updateDoc(spaceDoc(db, space, "tasks", taskId), {
    assigneeId,
    updatedAt: serverTimestamp(),
  });
}

// Replaces a task's full subtask list. Callers compute the next array
// client-side (toggle/add/delete) and pass the whole thing, matching the
// pattern used elsewhere in this file.
export async function setTaskSubtasks(
  db: Firestore,
  space: Space,
  taskId: string,
  subtasks: Subtask[],
) {
  await updateDoc(spaceDoc(db, space, "tasks", taskId), {
    subtasks,
    updatedAt: serverTimestamp(),
  });
}

// Bulk-updates title/group/priority across a set of task ids — used for
// "edit this series" so every upcoming occurrence changes together.
export async function updateSeriesTasks(
  db: Firestore,
  space: Space,
  taskIds: string[],
  updates: { title: string; groupId: string; priority: Priority },
) {
  for (let start = 0; start < taskIds.length; start += 400) {
    const batch = writeBatch(db);
    taskIds.slice(start, start + 400).forEach((taskId) => {
      batch.update(spaceDoc(db, space, "tasks", taskId), {
        title: updates.title,
        groupId: updates.groupId,
        priority: updates.priority,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }
}

export async function deleteTasks(
  db: Firestore,
  space: Space,
  ids: string[],
) {
  for (let start = 0; start < ids.length; start += 400) {
    const batch = writeBatch(db);
    ids.slice(start, start + 400).forEach((id) =>
      batch.delete(spaceDoc(db, space, "tasks", id)),
    );
    await batch.commit();
  }
}

const commitInChunks = async (
  db: Firestore,
  operations: Array<(batch: WriteBatch) => void>,
) => {
  for (let start = 0; start < operations.length; start += 400) {
    const batch = writeBatch(db);
    operations.slice(start, start + 400).forEach((operation) => operation(batch));
    await batch.commit();
  }
};

// Moves a list and its tasks between private and household. The list gets a
// fresh id (so ids never collide across spaces); tasks keep their ids, point
// at the new list, and keep their dates and subtasks. Everything is copied
// first and only then removed from the old space, so a failure part-way
// leaves a duplicate rather than losing anything.
export async function moveGroup(
  db: Firestore,
  from: Space,
  to: Space,
  group: Group,
  tasks: Task[],
  newGroupId: string,
) {
  const extra = creatorFields(to);
  const copies: Array<(batch: WriteBatch) => void> = [
    (batch) =>
      batch.set(spaceDoc(db, to, "groups", newGroupId), {
        name: group.name,
        color: group.color,
        ...extra,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    ...tasks.map((task) => (batch: WriteBatch) =>
      batch.set(spaceDoc(db, to, "tasks", task.id), {
        title: task.title,
        groupId: newGroupId,
        priority: task.priority,
        dueDate: task.dueDate,
        completed: task.completed,
        completedAt: task.completedAt
          ? Timestamp.fromDate(new Date(task.completedAt))
          : null,
        subtasks: task.subtasks,
        ...(task.seriesId ? { seriesId: task.seriesId } : {}),
        ...extra,
        createdAt: task.createdAt
          ? Timestamp.fromDate(new Date(task.createdAt))
          : serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    ),
  ];
  await commitInChunks(db, copies);

  const removals: Array<(batch: WriteBatch) => void> = [
    ...tasks.map((task) => (batch: WriteBatch) =>
      batch.delete(spaceDoc(db, from, "tasks", task.id)),
    ),
    (batch) => batch.delete(spaceDoc(db, from, "groups", group.id)),
  ];
  await commitInChunks(db, removals);
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

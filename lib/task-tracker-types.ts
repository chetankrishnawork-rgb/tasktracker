export type Priority = "High" | "Medium" | "Low";
export type Filter = "All" | "Today" | "Upcoming" | "Completed" | "Calendar" | "Stats";

export type Group = {
  id: string;
  name: string;
  color: string;
};

export type Subtask = {
  id: string;
  title: string;
  completed: boolean;
};

export type Task = {
  id: string;
  title: string;
  groupId: string;
  priority: Priority;
  dueDate: string;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
  subtasks: Subtask[];
  seriesId: string | null;
};

export type PreviousTrackerData = {
  groups: Group[];
  tasks: Task[];
};

export const defaultGroups: Group[] = [
  { id: "work", name: "Work", color: "#586A5B" },
  { id: "personal", name: "Personal", color: "#C4795A" },
  { id: "health", name: "Health", color: "#7886A3" },
];

export const groupColors = [
  "#586A5B",
  "#C4795A",
  "#7886A3",
  "#A87B45",
  "#8C6F89",
  "#4F7C79",
];

export const today = () => new Date().toISOString().slice(0, 10);

const formatDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Builds the list of due dates (YYYY-MM-DD) for a recurring task, one entry
// per workday in the range by default, optionally including weekends.
export const generateRecurringDates = (
  startDate: string,
  endDate: string,
  includeWeekends: boolean,
): string[] => {
  if (!startDate || !endDate) return [];
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }
  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const weekday = cursor.getDay();
    const isWeekend = weekday === 0 || weekday === 6;
    if (includeWeekends || !isWeekend) {
      const year = cursor.getFullYear();
      const month = String(cursor.getMonth() + 1).padStart(2, "0");
      const day = String(cursor.getDate()).padStart(2, "0");
      dates.push(`${year}-${month}-${day}`);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

// Escapes a single CSV field per RFC 4180: wrap in quotes and double up any
// quotes whenever the value contains a comma, quote, or newline.
const escapeCsvField = (value: string): string => {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

// Renders tasks (with their group names resolved) as a CSV string, ready to
// hand to a Blob for client-side download. Pure and dependency-free so it's
// easy to unit test independent of the DOM/Firestore.
export const tasksToCsv = (tasks: Task[], groups: Group[]): string => {
  const groupNameById = (groupId: string) =>
    groups.find((group) => group.id === groupId)?.name ?? groupId;

  const header = [
    "Title",
    "Group",
    "Priority",
    "Due date",
    "Completed",
    "Completed at",
  ];
  const rows = tasks.map((task) => [
    task.title,
    groupNameById(task.groupId),
    task.priority,
    task.dueDate,
    task.completed ? "Yes" : "No",
    task.completedAt ?? "",
  ]);

  return [header, ...rows]
    .map((row) => row.map((cell) => escapeCsvField(String(cell))).join(","))
    .join("\r\n");
};

// Completed/total counts for a task's subtasks, used to render progress
// chips like "2/5" without every call site re-deriving it.
export const subtaskSummary = (task: Task): { done: number; total: number } => ({
  done: task.subtasks.filter((subtask) => subtask.completed).length,
  total: task.subtasks.length,
});

// IDs of tasks belonging to a recurring series whose due date is on or
// after fromDate — the set that "edit series" / "delete series" acts on,
// leaving past occurrences untouched.
export const seriesTaskIds = (
  tasks: Task[],
  seriesId: string,
  fromDate: string,
): string[] =>
  tasks
    .filter((task) => task.seriesId === seriesId && task.dueDate >= fromDate)
    .map((task) => task.id);

// Current daily completion streak ending at referenceDate: counts backward
// from referenceDate (or the day before, if nothing's been completed yet
// today) as long as each day in a row has at least one completed task.
export const completionStreak = (tasks: Task[], referenceDate: string): number => {
  const completedDates = new Set(
    tasks
      .filter((task) => task.completed && task.completedAt)
      .map((task) => task.completedAt!.slice(0, 10)),
  );
  const cursor = new Date(`${referenceDate}T12:00:00`);
  if (Number.isNaN(cursor.getTime())) return 0;
  if (!completedDates.has(referenceDate)) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (completedDates.has(formatDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
};

// Completed-task counts for each of the `days` days ending at referenceDate
// (inclusive), oldest first — the data behind a simple activity bar chart.
export const completionsByDay = (
  tasks: Task[],
  days: number,
  referenceDate: string,
): { date: string; count: number }[] => {
  const counts = new Map<string, number>();
  tasks.forEach((task) => {
    if (task.completed && task.completedAt) {
      const key = task.completedAt.slice(0, 10);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  });
  const cursor = new Date(`${referenceDate}T12:00:00`);
  cursor.setDate(cursor.getDate() - (days - 1));
  const result: { date: string; count: number }[] = [];
  for (let i = 0; i < days; i += 1) {
    const key = formatDateKey(cursor);
    result.push({ date: key, count: counts.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
};

// Per-group completed/total task counts, used for the "by group" breakdown
// in the stats view.
export const tasksByGroupCounts = (
  tasks: Task[],
  groups: Group[],
): { groupId: string; name: string; color: string; total: number; completed: number }[] =>
  groups.map((group) => {
    const groupTasks = tasks.filter((task) => task.groupId === group.id);
    return {
      groupId: group.id,
      name: group.name,
      color: group.color,
      total: groupTasks.length,
      completed: groupTasks.filter((task) => task.completed).length,
    };
  });

export const parseLegacyData = (value: string | null): PreviousTrackerData | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PreviousTrackerData>;
    const groups = Array.isArray(parsed.groups) ? parsed.groups : [];
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    if (!groups.length && !tasks.length) return null;
    return { groups, tasks };
  } catch {
    return null;
  }
};

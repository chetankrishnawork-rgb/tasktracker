export type Priority = "High" | "Medium" | "Low";
export type Filter = "All" | "Today" | "Upcoming" | "Completed" | "Calendar";

export type Group = {
  id: string;
  name: string;
  color: string;
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

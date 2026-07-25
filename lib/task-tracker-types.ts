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

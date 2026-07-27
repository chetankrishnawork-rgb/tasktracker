"use client";

import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  browserLocalPersistence,
  type User,
} from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createGroup,
  createRecurringTasks,
  createTasks,
  deleteGroup,
  deleteTasks,
  ensureWorkspace,
  importLegacyData,
  localMigrationComplete,
  setTaskCompleted,
  setTaskSubtasks,
  subscribeToWorkspace,
  updateSeriesTasks,
} from "@/lib/task-tracker-repository";
import {
  generateRecurringDates,
  groupColors,
  parseLegacyData,
  seriesTaskIds,
  subtaskSummary,
  tasksToCsv,
  today,
  type Filter,
  type Group,
  type PreviousTrackerData,
  type Priority,
  type Task,
} from "@/lib/task-tracker-types";
import {
  firebaseConfigured,
  getFirebaseServices,
} from "@/lib/firebase";
import {
  IconArrowUpRight,
  IconCalendar,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconDownload,
  IconHash,
  IconLogOut,
  IconMoon,
  IconPlus,
  IconRepeat,
  IconSearch,
  IconSun,
  IconUpload,
  IconX,
} from "@/lib/icons";

type AuthStatus = "loading" | "signed-out" | "signed-in" | "unconfigured";
type Composer = "single" | "bulk" | "recurring" | null;
type Theme = "light" | "dark";

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// Preserve one-time imports from the pre-Firebase browser release without
// carrying its former product name into the current interface or data model.
const previousDataStorageKey = ["day", "mark-data"].join("");
const themeStorageKey = "task-tracker-theme";

const messageForError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return message
    .replace(/^Firebase:\s*/i, "")
    .replace(/\s*\(auth\/[\w-]+\)\.?$/i, "")
    .replace(/\s*\(firestore\/[\w-]+\)\.?$/i, "");
};

function AuthScreen({ mode }: { mode: "signin" | "configure" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  if (mode === "configure") {
    return (
      <main className="auth-shell">
        <section className="auth-card setup-card">
          <div className="brand auth-brand"><span className="brand-mark">T</span><span>Task Tracker</span></div>
          <span className="eyebrow">FIREBASE SETUP REQUIRED</span>
          <h1>Connect your private workspace</h1>
          <p>Task Tracker is built and ready. Add your Firebase web-app values to a local <code>.env.local</code> file before starting the app.</p>
          <div className="config-list" aria-label="Required environment variables">
            <code>NEXT_PUBLIC_FIREBASE_API_KEY</code>
            <code>NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN</code>
            <code>NEXT_PUBLIC_FIREBASE_PROJECT_ID</code>
            <code>NEXT_PUBLIC_FIREBASE_APP_ID</code>
          </div>
          <p className="fine-print">The complete template is included in <code>.env.example</code>.</p>
        </section>
      </main>
    );
  }

  const services = getFirebaseServices();

  const authenticateWithGoogle = async () => {
    if (!services) return;
    setBusy(true);
    setNotice("");
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await signInWithPopup(services.auth, provider);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "auth/popup-blocked") {
        await signInWithRedirect(services.auth, provider);
        return;
      }
      setNotice(messageForError(error));
    } finally {
      setBusy(false);
    }
  };

  const authenticateWithEmail = async (event: FormEvent) => {
    event.preventDefault();
    if (!services) return;
    setBusy(true);
    setNotice("");
    try {
      if (creating) {
        await createUserWithEmailAndPassword(services.auth, email, password);
      } else {
        await signInWithEmailAndPassword(services.auth, email, password);
      }
    } catch (error) {
      setNotice(messageForError(error));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!services || !email) {
      setNotice("Enter your email address first.");
      return;
    }
    try {
      await sendPasswordResetEmail(services.auth, email);
      setNotice("Password reset email sent.");
    } catch (error) {
      setNotice(messageForError(error));
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand auth-brand"><span className="brand-mark">T</span><span>Task Tracker</span></div>
        <span className="eyebrow">YOUR DAY, EVERYWHERE</span>
        <h1>{creating ? "Create your account" : "Welcome back"}</h1>
        <p>Sign in to keep your tasks private, synchronized, and available on every device.</p>
        <button className="google-button" onClick={authenticateWithGoogle} disabled={busy}>
          <span className="google-mark">G</span> Continue with Google
        </button>
        <div className="divider"><span>or use email</span></div>
        <form onSubmit={authenticateWithEmail}>
          <label>Email<input type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Password<input type="password" autoComplete={creating ? "new-password" : "current-password"} minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {notice && <div className="auth-notice" role="status">{notice}</div>}
          <button className="add-button auth-submit" disabled={busy}>{busy ? "Please wait…" : creating ? "Create account" : "Sign in"}</button>
        </form>
        {!creating && <button className="text-button" onClick={resetPassword}>Forgot password?</button>}
        <p className="auth-switch">{creating ? "Already have an account?" : "New to Task Tracker?"} <button onClick={() => { setCreating(!creating); setNotice(""); }}>{creating ? "Sign in" : "Create one"}</button></p>
      </section>
    </main>
  );
}

export default function TaskTrackerApp() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>(
    firebaseConfigured ? "loading" : "unconfigured",
  );
  const [user, setUser] = useState<User | null>(null);
  const [db, setDb] = useState<Firestore | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [groupsPending, setGroupsPending] = useState(false);
  const [tasksPending, setTasksPending] = useState(false);
  const [usingCache, setUsingCache] = useState(false);
  const [online, setOnline] = useState(true);
  const [theme, setTheme] = useState<Theme>("light");
  const [filter, setFilter] = useState<Filter>("All");
  const [groupFilter, setGroupFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [composer, setComposer] = useState<Composer>(null);
  const [title, setTitle] = useState("");
  const [bulkTitles, setBulkTitles] = useState("");
  const [groupId, setGroupId] = useState("work");
  const [priority, setPriority] = useState<Priority>("Medium");
  const [dueDate, setDueDate] = useState(today());
  const [recurringStart, setRecurringStart] = useState(today());
  const [recurringEnd, setRecurringEnd] = useState(today());
  const [includeWeekends, setIncludeWeekends] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupColor, setGroupColor] = useState(groupColors[3]);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [seriesModalTask, setSeriesModalTask] = useState<Task | null>(null);
  const [seriesTitle, setSeriesTitle] = useState("");
  const [seriesGroupId, setSeriesGroupId] = useState("work");
  const [seriesPriority, setSeriesPriority] = useState<Priority>("Medium");
  const [monthCursor, setMonthCursor] = useState(() => {
    const start = new Date();
    start.setDate(1);
    return start;
  });
  const [legacyData, setLegacyData] = useState<PreviousTrackerData | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const migrationCheckedFor = useRef("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!firebaseConfigured) return;
    const services = getFirebaseServices();
    if (!services) {
      // This effect synchronizes React with Firebase's external client state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAuthStatus("unconfigured");
      return;
    }
    setDb(services.db);
    setPersistence(services.auth, browserLocalPersistence).catch(() => {});
    getRedirectResult(services.auth).catch((error) =>
      setNotice(messageForError(error)),
    );
    return onAuthStateChanged(services.auth, (currentUser) => {
      setGroups([]);
      setTasks([]);
      setGroupsLoaded(false);
      setTasksLoaded(false);
      setUser(currentUser);
      setAuthStatus(currentUser ? "signed-in" : "signed-out");
    });
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const updateConnection = () => setOnline(navigator.onLine);
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(themeStorageKey);
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (authStatus !== "signed-in") return;
      const targetElement = event.target as HTMLElement | null;
      const isTyping = Boolean(
        targetElement &&
          (targetElement.tagName === "INPUT" ||
            targetElement.tagName === "TEXTAREA" ||
            targetElement.tagName === "SELECT" ||
            targetElement.isContentEditable),
      );

      if (event.key === "Escape") {
        setComposer(null);
        setNewGroup(false);
        setDeleteIds([]);
        setDeleteGroupId(null);
        setConfirmSignOut(false);
        setExpandedTaskId(null);
        setSeriesModalTask(null);
        return;
      }

      if (isTyping || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        setComposer("single");
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [authStatus]);

  useEffect(() => {
    if (!user || !db) return;
    let active = true;
    let unsubscribe = () => {};

    const connect = async () => {
      try {
        await ensureWorkspace(db, user);
      } catch (error) {
        if (navigator.onLine) setNotice(messageForError(error));
      }
      if (!active) return;
      unsubscribe = subscribeToWorkspace(db, user.uid, {
        onGroups: (nextGroups, pending, cached) => {
          setGroups(nextGroups);
          setGroupsPending(pending);
          setUsingCache((current) => current || cached);
          setGroupsLoaded(true);
          if (nextGroups.length) {
            setGroupId((current) =>
              nextGroups.some((group) => group.id === current)
                ? current
                : nextGroups[0].id,
            );
          }
        },
        onTasks: (nextTasks, pending, cached) => {
          setTasks(nextTasks);
          setTasksPending(pending);
          setUsingCache(cached);
          setTasksLoaded(true);
        },
        onError: (error) => setNotice(messageForError(error)),
      });
    };
    connect();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [user, db]);

  useEffect(() => {
    if (!user || !db || !groupsLoaded || !tasksLoaded) return;
    if (migrationCheckedFor.current === user.uid) return;
    migrationCheckedFor.current = user.uid;
    const checkMigration = async () => {
      if (localStorage.getItem(`task-tracker-migration-dismissed-${user.uid}`)) return;
      const complete = await localMigrationComplete(db, user.uid);
      if (complete) {
        localStorage.removeItem(previousDataStorageKey);
        return;
      }
      setLegacyData(parseLegacyData(localStorage.getItem(previousDataStorageKey)));
    };
    checkMigration().catch((error) => setNotice(messageForError(error)));
  }, [user, db, groupsLoaded, tasksLoaded]);

  const counts = useMemo(
    () => ({
      total: tasks.filter((task) => !task.completed).length,
      today: tasks.filter(
        (task) => !task.completed && task.dueDate === today(),
      ).length,
      done: tasks.filter((task) => task.completed).length,
    }),
    [tasks],
  );

  const visible = useMemo(
    () =>
      tasks
        .filter((task) => groupFilter === "all" || task.groupId === groupFilter)
        .filter((task) =>
          task.title.toLowerCase().includes(query.trim().toLowerCase()),
        )
        .filter((task) => {
          if (filter === "Today")
            return !task.completed && task.dueDate === today();
          if (filter === "Upcoming")
            return !task.completed && Boolean(task.dueDate) && task.dueDate > today();
          if (filter === "Completed") return task.completed;
          return true;
        })
        .sort(
          (a, b) =>
            Number(a.completed) - Number(b.completed) ||
            (a.dueDate || "9999").localeCompare(b.dueDate || "9999"),
        ),
    [tasks, groupFilter, query, filter],
  );

  const recurringDates = useMemo(
    () => generateRecurringDates(recurringStart, recurringEnd, includeWeekends),
    [recurringStart, recurringEnd, includeWeekends],
  );

  if (authStatus === "unconfigured") return <AuthScreen mode="configure" />;
  if (authStatus === "loading")
    return <main className="loading-screen"><span className="brand-mark">T</span><p>Opening Task Tracker…</p></main>;
  if (authStatus === "signed-out" || !user || !db)
    return <AuthScreen mode="signin" />;

  const groupById = (id: string) =>
    groups.find((group) => group.id === id) ?? groups[0];
  const syncText = !online
    ? "Offline — changes will sync"
    : groupsPending || tasksPending
      ? "Saving changes…"
      : usingCache
        ? "Reconnecting…"
        : "Synced";

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try {
      await operation();
    } catch (error) {
      setNotice(messageForError(error));
    } finally {
      setBusy(false);
    }
  };

  const resetComposer = () => {
    setComposer(null);
    setTitle("");
    setBulkTitles("");
    setRecurringStart(today());
    setRecurringEnd(today());
    setIncludeWeekends(false);
  };

  const addTaskRecords = async (event: FormEvent) => {
    event.preventDefault();
    if (composer === "recurring") {
      if (!title.trim() || !groupId || !recurringDates.length) return;
      await run(async () => {
        await createRecurringTasks(db, user.uid, title.trim(), {
          groupId,
          priority,
          dates: recurringDates,
        });
        resetComposer();
      });
      return;
    }
    const titles = composer === "bulk"
      ? bulkTitles.split("\n").map((item) => item.trim()).filter(Boolean)
      : [title.trim()].filter(Boolean);
    if (!titles.length || !groupId) return;
    await run(async () => {
      await createTasks(db, user.uid, titles, { groupId, priority, dueDate });
      resetComposer();
    });
  };

  const addGroupRecord = async (event: FormEvent) => {
    event.preventDefault();
    if (!groupName.trim()) return;
    const group = { id: makeId(), name: groupName.trim(), color: groupColor };
    await run(async () => {
      await createGroup(db, user.uid, group);
      setGroupId(group.id);
      setGroupName("");
      setNewGroup(false);
    });
  };

  const confirmDelete = async () => {
    await run(async () => {
      await deleteTasks(db, user.uid, deleteIds);
      setSelected((current) =>
        current.filter((id) => !deleteIds.includes(id)),
      );
      setDeleteIds([]);
    });
  };

  const remainingGroupsAfterDelete = groups.filter(
    (group) => group.id !== deleteGroupId,
  );
  const groupPendingDeleteTaskCount = deleteGroupId
    ? tasks.filter((task) => task.groupId === deleteGroupId).length
    : 0;

  const confirmDeleteGroup = async () => {
    if (!deleteGroupId) return;
    const fallbackGroupId = remainingGroupsAfterDelete[0]?.id;
    if (!fallbackGroupId) return;
    const affectedTaskIds = tasks
      .filter((task) => task.groupId === deleteGroupId)
      .map((task) => task.id);
    await run(async () => {
      await deleteGroup(db, user.uid, deleteGroupId, fallbackGroupId, affectedTaskIds);
      if (groupFilter === deleteGroupId) setGroupFilter("all");
      if (groupId === deleteGroupId) setGroupId(fallbackGroupId);
      setDeleteGroupId(null);
    });
  };

  const confirmSignOutAndClose = async () => {
    await run(async () => {
      await signOut(getFirebaseServices()!.auth);
      setConfirmSignOut(false);
    });
  };

  const importPreviousData = async () => {
    if (!legacyData) return;
    await run(async () => {
      await importLegacyData(db, user.uid, legacyData);
      localStorage.removeItem(previousDataStorageKey);
      setLegacyData(null);
      setNotice("Your previous tasks were imported successfully.");
    });
  };

  const dismissMigration = () => {
    localStorage.setItem(`task-tracker-migration-dismissed-${user.uid}`, "true");
    setLegacyData(null);
  };

  const exportTasksAsCsv = () => {
    const csv = tasksToCsv(tasks, groups);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `task-tracker-export-${today()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const toggleSubtaskPanel = (taskId: string) => {
    setExpandedTaskId((current) => (current === taskId ? null : taskId));
    setNewSubtaskTitle("");
  };

  const addSubtask = async (task: Task) => {
    const titleValue = newSubtaskTitle.trim();
    if (!titleValue) return;
    const nextSubtasks = [
      ...task.subtasks,
      { id: makeId(), title: titleValue, completed: false },
    ];
    await run(async () => {
      await setTaskSubtasks(db, user.uid, task.id, nextSubtasks);
      setNewSubtaskTitle("");
    });
  };

  const toggleSubtask = async (task: Task, subtaskId: string) => {
    const nextSubtasks = task.subtasks.map((subtask) =>
      subtask.id === subtaskId
        ? { ...subtask, completed: !subtask.completed }
        : subtask,
    );
    await run(() => setTaskSubtasks(db, user.uid, task.id, nextSubtasks));
  };

  const deleteSubtask = async (task: Task, subtaskId: string) => {
    const nextSubtasks = task.subtasks.filter((subtask) => subtask.id !== subtaskId);
    await run(() => setTaskSubtasks(db, user.uid, task.id, nextSubtasks));
  };

  const openSeriesModal = (task: Task) => {
    setSeriesModalTask(task);
    setSeriesTitle(task.title);
    setSeriesGroupId(task.groupId);
    setSeriesPriority(task.priority);
  };

  const updateSeries = async (event: FormEvent) => {
    event.preventDefault();
    if (!seriesModalTask?.seriesId || !seriesTitle.trim()) return;
    const ids = seriesTaskIds(tasks, seriesModalTask.seriesId, today());
    if (!ids.length) return;
    await run(async () => {
      await updateSeriesTasks(db, user.uid, ids, {
        title: seriesTitle.trim(),
        groupId: seriesGroupId,
        priority: seriesPriority,
      });
      setSeriesModalTask(null);
    });
  };

  const deleteSeriesUpcoming = () => {
    if (!seriesModalTask?.seriesId) return;
    const ids = seriesTaskIds(tasks, seriesModalTask.seriesId, today());
    setSeriesModalTask(null);
    setDeleteIds(ids);
  };

  const formatDate = (date: string) => {
    if (!date) return "No due date";
    if (date === today()) return "Due today";
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
    }).format(new Date(`${date}T12:00:00`));
  };

  const toDateKey = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const monthLabel = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(monthCursor);
  const firstWeekday = new Date(
    monthCursor.getFullYear(),
    monthCursor.getMonth(),
    1,
  ).getDay();
  const daysInMonth = new Date(
    monthCursor.getFullYear(),
    monthCursor.getMonth() + 1,
    0,
  ).getDate();
  const totalCalendarCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const calendarDates: (Date | null)[] = Array.from(
    { length: totalCalendarCells },
    (_, index) => {
      const dayNumber = index - firstWeekday + 1;
      return dayNumber >= 1 && dayNumber <= daysInMonth
        ? new Date(monthCursor.getFullYear(), monthCursor.getMonth(), dayNumber)
        : null;
    },
  );
  const tasksByDate = new Map<string, Task[]>();
  visible.forEach((task) => {
    if (!task.dueDate) return;
    const existing = tasksByDate.get(task.dueDate) ?? [];
    existing.push(task);
    tasksByDate.set(task.dueDate, existing);
  });
  const todayKey = toDateKey(new Date());

  const progress = tasks.length
    ? Math.round((counts.done / tasks.length) * 100)
    : 0;
  const initials = (user.displayName || user.email || "T")
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">T</span><span>Task Tracker</span></div>
        <nav className="main-nav" aria-label="Task views">
          {(["All", "Today", "Upcoming", "Completed", "Calendar"] as Filter[]).map((item) => (
            <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
              <span className="nav-icon">{item === "All" ? <IconHash /> : item === "Today" ? <IconClock /> : item === "Upcoming" ? <IconArrowUpRight /> : item === "Completed" ? <IconCheck /> : <IconCalendar />}</span>
              <span className="nav-label">{item}</span>
              {item !== "Calendar" && <span className="nav-count">{item === "All" ? tasks.length : item === "Today" ? counts.today : item === "Completed" ? counts.done : tasks.filter((task) => !task.completed && task.dueDate > today()).length}</span>}
            </button>
          ))}
        </nav>
        <div className="group-heading"><span>Groups</span><button aria-label="Add group" onClick={() => setNewGroup(true)}><IconPlus /></button></div>
        <div className="group-list">
          <button className={groupFilter === "all" ? "group-active" : ""} onClick={() => setGroupFilter("all")}><span className="all-dot" />All groups</button>
          {groups.map((group) => (
            <div className="group-row" key={group.id}>
              <button className={`group-nav-button ${groupFilter === group.id ? "group-active" : ""}`} onClick={() => setGroupFilter(group.id)}>
                <span className="group-dot" style={{ background: group.color }} />{group.name}
                <span className="nav-count">{tasks.filter((task) => task.groupId === group.id).length}</span>
              </button>
              <button className="group-delete" aria-label={`Delete group ${group.name}`} title={`Delete ${group.name}`} onClick={() => setDeleteGroupId(group.id)}><IconX /></button>
            </div>
          ))}
        </div>
        <div className="account-card">
          <span className="avatar">{initials}</span>
          <div><strong>{user.displayName || "Task Tracker user"}</strong><span>{user.email}</span></div>
          <button aria-label="Sign out" title="Sign out" onClick={() => setConfirmSignOut(true)}><IconLogOut /></button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <label className="search"><span><IconSearch /></span><input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks" aria-label="Search tasks" title="Press / to search" /></label>
          <div className="sync-state" data-online={online}><i />{syncText}</div>
          <div className="top-actions">
            <button className="quiet-button icon-button" aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"} onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}>{theme === "dark" ? <IconSun /> : <IconMoon />}</button>
            <button className="quiet-button icon-button" aria-label="Export tasks as CSV" title="Export CSV" onClick={exportTasksAsCsv}><IconDownload /></button>
            <button className="bulk-button" onClick={() => setComposer("recurring")}><IconRepeat /> <span>Repeating</span></button>
            <button className="bulk-button" onClick={() => setComposer("bulk")}><IconPlus /> <span>Bulk add</span></button>
            <button className="add-button" onClick={() => setComposer("single")}><IconPlus /> Add task</button>
          </div>
        </header>

        <div className="mobile-group-strip" aria-label="Filter by group">
          <button className={groupFilter === "all" ? "active" : ""} onClick={() => setGroupFilter("all")}>All</button>
          {groups.map((group) => (
            <span className="mobile-chip" key={group.id}>
              <button className={groupFilter === group.id ? "active" : ""} onClick={() => setGroupFilter(group.id)}><i style={{ background: group.color }} />{group.name}</button>
              <button className="mobile-chip-delete" aria-label={`Delete group ${group.name}`} onClick={() => setDeleteGroupId(group.id)}><IconX /></button>
            </span>
          ))}
          <button className="new-group-chip" onClick={() => setNewGroup(true)}><IconPlus /> Group</button>
        </div>

        <div className="content">
          <div className="date-kicker">{new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</div>
          <div className="title-row">
            <div><h1>{filter === "All" ? "My day" : filter}</h1><p>{counts.today ? `${counts.today} task${counts.today === 1 ? "" : "s"} due today` : "A clear day ahead"}</p></div>
            <div className="progress-ring" style={{ "--progress": `${progress}%` } as React.CSSProperties}><div><strong>{progress}%</strong><span>done</span></div></div>
          </div>

          <div className="summary-strip">
            <div><strong>{counts.total}</strong><span>Open tasks</span></div>
            <div><strong>{counts.today}</strong><span>Due today</span></div>
            <div><strong>{counts.done}</strong><span>Completed</span></div>
          </div>

          {notice && <div className="notice-banner" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss message"><IconX /></button></div>}
          {filter !== "Calendar" && selected.length > 0 && <div className="selection-bar"><strong>{selected.length} selected</strong><button onClick={() => setSelected([])}>Clear</button><button className="delete-text" onClick={() => setDeleteIds(selected)}>Delete selected</button></div>}

          {filter === "Calendar" ? (
            <div className="calendar-view">
              <div className="calendar-toolbar">
                <button type="button" className="quiet-button" aria-label="Previous month" onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))}><IconChevronLeft /></button>
                <h2>{monthLabel}</h2>
                <button type="button" className="quiet-button" aria-label="Next month" onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))}><IconChevronRight /></button>
                <button type="button" className="text-button calendar-today-button" onClick={() => { const now = new Date(); setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1)); }}>Today</button>
              </div>
              <div className="calendar-weekdays">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}
              </div>
              <div className="calendar-grid" aria-busy={!groupsLoaded || !tasksLoaded}>
                {calendarDates.map((date, index) => {
                  if (!date) return <div className="calendar-cell empty" key={`empty-${index}`} />;
                  const dateKey = toDateKey(date);
                  const dayTasks = tasksByDate.get(dateKey) ?? [];
                  const visibleTasks = dayTasks.slice(0, 3);
                  const overflow = dayTasks.length - visibleTasks.length;
                  return (
                    <div className={`calendar-cell ${dateKey === todayKey ? "is-today" : ""}`} key={dateKey}>
                      <span className="calendar-date">{date.getDate()}</span>
                      <div className="calendar-tasks">
                        {visibleTasks.map((task) => {
                          const group = groupById(task.groupId);
                          return (
                            <button
                              type="button"
                              key={task.id}
                              className={`calendar-task ${task.completed ? "completed" : ""}`}
                              style={{ "--group-color": group?.color ?? "#586A5B" } as React.CSSProperties}
                              title={task.title}
                              onClick={() => run(() => setTaskCompleted(db, user.uid, task))}
                            >
                              {task.title}
                            </button>
                          );
                        })}
                        {overflow > 0 && <span className="calendar-more">+{overflow} more</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              {groupsLoaded && tasksLoaded && !visible.length && <div className="empty-state"><span><IconCheck /></span><h2>Nothing here</h2><p>Add a task or try another view.</p></div>}
            </div>
          ) : (
            <>
              <div className="list-header"><span>{visible.length} tasks</span><span>Sorted by due date</span></div>
              <div className="task-list" aria-busy={!groupsLoaded || !tasksLoaded}>
                {(!groupsLoaded || !tasksLoaded) && <div className="empty-state"><span className="loading-dot">T</span><h2>Syncing your day</h2><p>Your tasks will appear in a moment.</p></div>}
                {groupsLoaded && tasksLoaded && visible.map((task) => {
                  const group = groupById(task.groupId);
                  const summary = subtaskSummary(task);
                  const expanded = expandedTaskId === task.id;
                  return (
                    <div className="task-row-group" key={task.id}>
                      <article className={`task-row ${task.completed ? "completed" : ""}`} style={{ "--group-color": group?.color ?? "#586A5B" } as React.CSSProperties}>
                        <input className="select-box" type="checkbox" aria-label={`Select ${task.title}`} checked={selected.includes(task.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, task.id])] : current.filter((id) => id !== task.id))} />
                        <button className="complete-box" disabled={busy} aria-label={task.completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`} onClick={() => run(() => setTaskCompleted(db, user.uid, task))}>{task.completed ? <IconCheck /> : null}</button>
                        <div className="task-main">
                          <h2>{task.title}</h2>
                          <div className="task-meta">
                            <span className="group-tag"><i style={{ background: group?.color ?? "#586A5B" }} />{group?.name ?? "Group"}</span>
                            <span>{formatDate(task.dueDate)}</span>
                            {task.completedAt && <span>Completed {new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(task.completedAt))}</span>}
                            {task.seriesId && <button type="button" className="series-chip" aria-label="Edit repeating series" title="Part of a repeating series — edit or delete upcoming occurrences" onClick={() => openSeriesModal(task)}><IconRepeat /></button>}
                          </div>
                        </div>
                        <span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span>
                        <button type="button" className={`subtask-chip ${expanded ? "expanded" : ""} ${summary.total > 0 && summary.done === summary.total ? "all-done" : ""}`} aria-label={summary.total ? `${summary.done} of ${summary.total} subtasks done, toggle checklist` : "Add subtasks"} title={summary.total ? `${summary.done}/${summary.total} subtasks` : "Add subtasks"} onClick={() => toggleSubtaskPanel(task.id)}>
                          {summary.total > 0 ? `${summary.done}/${summary.total}` : <IconPlus />}
                        </button>
                        <button className="row-delete" aria-label={`Delete ${task.title}`} onClick={() => setDeleteIds([task.id])}><IconX /></button>
                      </article>
                      {expanded && (
                        <div className="subtask-panel">
                          {task.subtasks.map((subtask) => (
                            <div className="subtask-row" key={subtask.id}>
                              <button type="button" className={`subtask-check ${subtask.completed ? "completed" : ""}`} disabled={busy} aria-label={subtask.completed ? `Mark ${subtask.title} incomplete` : `Complete ${subtask.title}`} onClick={() => toggleSubtask(task, subtask.id)}>{subtask.completed ? <IconCheck /> : null}</button>
                              <span className={subtask.completed ? "subtask-done-text" : ""}>{subtask.title}</span>
                              <button type="button" className="subtask-delete" disabled={busy} aria-label={`Delete subtask ${subtask.title}`} onClick={() => deleteSubtask(task, subtask.id)}><IconX /></button>
                            </div>
                          ))}
                          <form className="subtask-add-row" onSubmit={(event) => { event.preventDefault(); addSubtask(task); }}>
                            <input value={newSubtaskTitle} onChange={(event) => setNewSubtaskTitle(event.target.value)} placeholder="Add subtask" disabled={busy || task.subtasks.length >= 50} />
                            <button type="submit" aria-label="Add subtask" disabled={busy || !newSubtaskTitle.trim() || task.subtasks.length >= 50}><IconPlus /></button>
                          </form>
                        </div>
                      )}
                    </div>
                  );
                })}
                {groupsLoaded && tasksLoaded && !visible.length && <div className="empty-state"><span><IconCheck /></span><h2>Nothing here</h2><p>Add a task or try another view.</p></div>}
              </div>
            </>
          )}
        </div>
      </section>

      {composer && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && resetComposer()}>
          <form className="modal" onSubmit={addTaskRecords}>
            <div className="modal-head"><div><span className="eyebrow">{composer === "bulk" ? "QUICK CAPTURE" : composer === "recurring" ? "REPEATING TASK" : "NEW TASK"}</span><h2>{composer === "bulk" ? "Add multiple tasks" : composer === "recurring" ? "Add a repeating task" : "Add a task"}</h2></div><button type="button" onClick={resetComposer} aria-label="Close"><IconX /></button></div>
            {composer === "bulk" ? <label>Tasks <span className="label-hint">One per line</span><textarea autoFocus value={bulkTitles} onChange={(event) => setBulkTitles(event.target.value)} placeholder={"Prepare slides\nSend weekly update\nSchedule review"} required /></label> : <label>Task name<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs to be done?" required /></label>}
            <div className={`form-grid${composer === "recurring" ? " two-col" : ""}`}>
              <label>Group<select value={groupId} onChange={(event) => setGroupId(event.target.value)}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
              <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}><option>High</option><option>Medium</option><option>Low</option></select></label>
              {composer !== "recurring" && <label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>}
            </div>
            {composer === "recurring" && (
              <>
                <div className="form-grid two-col">
                  <label>Start date<input type="date" value={recurringStart} onChange={(event) => setRecurringStart(event.target.value)} required /></label>
                  <label>End date<input type="date" value={recurringEnd} min={recurringStart} onChange={(event) => setRecurringEnd(event.target.value)} required /></label>
                </div>
                <label className="checkbox-row"><input type="checkbox" checked={includeWeekends} onChange={(event) => setIncludeWeekends(event.target.checked)} /> Include weekends</label>
                <p className="label-hint recurring-count">{recurringDates.length ? `${recurringDates.length} task${recurringDates.length === 1 ? "" : "s"} will be created` : "Pick a date range to see how many tasks will be created"}</p>
              </>
            )}
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={resetComposer}>Cancel</button><button className="add-button" disabled={busy || (composer === "recurring" && !recurringDates.length)}>{busy ? "Saving…" : composer === "bulk" ? "Add tasks" : composer === "recurring" ? "Add repeating task" : "Add task"}</button></div>
          </form>
        </div>
      )}

      {newGroup && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setNewGroup(false)}>
          <form className="modal small-modal" onSubmit={addGroupRecord}>
            <div className="modal-head"><div><span className="eyebrow">ORGANIZE</span><h2>New group</h2></div><button type="button" onClick={() => setNewGroup(false)} aria-label="Close"><IconX /></button></div>
            <label>Group name<input autoFocus value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="e.g. Learning" required /></label>
            <fieldset><legend>Color</legend><div className="color-row">{groupColors.map((color) => <button type="button" key={color} aria-label={`Use color ${color}`} className={groupColor === color ? "color-selected" : ""} style={{ background: color }} onClick={() => setGroupColor(color)} />)}</div></fieldset>
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setNewGroup(false)}>Cancel</button><button className="add-button" disabled={busy}>{busy ? "Creating…" : "Create group"}</button></div>
          </form>
        </div>
      )}

      {seriesModalTask && (() => {
        const upcomingIds = seriesModalTask.seriesId
          ? seriesTaskIds(tasks, seriesModalTask.seriesId, today())
          : [];
        return (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSeriesModalTask(null)}>
            <form className="modal small-modal" onSubmit={updateSeries}>
              <div className="modal-head"><div><span className="eyebrow">REPEATING SERIES</span><h2>Edit upcoming occurrences</h2></div><button type="button" onClick={() => setSeriesModalTask(null)} aria-label="Close"><IconX /></button></div>
              <p className="series-modal-note">
                {upcomingIds.length
                  ? `Applies to ${upcomingIds.length} upcoming occurrence${upcomingIds.length === 1 ? "" : "s"} in this series. Past occurrences are left as-is.`
                  : "No upcoming occurrences left in this series — nothing to edit or delete."}
              </p>
              <label>Task name<input autoFocus value={seriesTitle} onChange={(event) => setSeriesTitle(event.target.value)} required /></label>
              <div className="form-grid two-col">
                <label>Group<select value={seriesGroupId} onChange={(event) => setSeriesGroupId(event.target.value)}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
                <label>Priority<select value={seriesPriority} onChange={(event) => setSeriesPriority(event.target.value as Priority)}><option>High</option><option>Medium</option><option>Low</option></select></label>
              </div>
              <div className="modal-actions split-actions">
                <button type="button" className="danger-button" disabled={busy || !upcomingIds.length} onClick={deleteSeriesUpcoming}>Delete upcoming</button>
                <div className="modal-actions-right">
                  <button type="button" className="quiet-button" onClick={() => setSeriesModalTask(null)}>Cancel</button>
                  <button className="add-button" disabled={busy || !upcomingIds.length}>{busy ? "Saving…" : "Update series"}</button>
                </div>
              </div>
            </form>
          </div>
        );
      })()}

      {deleteIds.length > 0 && (
        <div className="modal-backdrop">
          <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
            <div className="warning-mark">!</div><h2 id="delete-title">Delete {deleteIds.length === 1 ? "this task" : `${deleteIds.length} tasks`}?</h2>
            <p>This action can’t be undone. {deleteIds.length === 1 ? "The selected task" : "The selected tasks"} will be permanently removed from every synced device.</p>
            <div className="modal-actions"><button className="quiet-button" disabled={busy} onClick={() => setDeleteIds([])}>Keep {deleteIds.length === 1 ? "task" : "tasks"}</button><button className="danger-button" disabled={busy} onClick={confirmDelete}>{busy ? "Deleting…" : "Yes, delete"}</button></div>
          </div>
        </div>
      )}

      {deleteGroupId && (
        <div className="modal-backdrop">
          <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-group-title">
            <div className="warning-mark">!</div>
            <h2 id="delete-group-title">Delete &ldquo;{groups.find((group) => group.id === deleteGroupId)?.name}&rdquo;?</h2>
            {remainingGroupsAfterDelete.length === 0 ? (
              <p>You need at least one group to keep using Task Tracker, so this one can&rsquo;t be deleted yet. Create another group first, then come back to remove this one.</p>
            ) : (
              <p>
                This action can&rsquo;t be undone.
                {groupPendingDeleteTaskCount > 0
                  ? ` ${groupPendingDeleteTaskCount} task${groupPendingDeleteTaskCount === 1 ? "" : "s"} in this group will be moved to "${remainingGroupsAfterDelete[0].name}".`
                  : ""}
              </p>
            )}
            <div className="modal-actions">
              <button className="quiet-button" disabled={busy} onClick={() => setDeleteGroupId(null)}>{remainingGroupsAfterDelete.length === 0 ? "Okay" : "Keep group"}</button>
              {remainingGroupsAfterDelete.length > 0 && (
                <button className="danger-button" disabled={busy} onClick={confirmDeleteGroup}>{busy ? "Deleting…" : "Yes, delete"}</button>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmSignOut && (
        <div className="modal-backdrop">
          <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="signout-title">
            <div className="warning-mark">!</div>
            <h2 id="signout-title">Sign out of Task Tracker?</h2>
            <p>You&rsquo;ll need to sign back in to see your tasks again on this device.</p>
            <div className="modal-actions">
              <button className="quiet-button" disabled={busy} onClick={() => setConfirmSignOut(false)}>Stay signed in</button>
              <button className="danger-button" disabled={busy} onClick={confirmSignOutAndClose}>{busy ? "Signing out…" : "Yes, sign out"}</button>
            </div>
          </div>
        </div>
      )}

      {legacyData && (
        <div className="modal-backdrop">
          <div className="modal migration-modal" role="dialog" aria-modal="true" aria-labelledby="migration-title">
            <span className="migration-mark"><IconUpload /></span><span className="eyebrow">ONE-TIME IMPORT</span><h2 id="migration-title">Bring your previous tracker data</h2>
            <p>We found {legacyData.tasks.length} task{legacyData.tasks.length === 1 ? "" : "s"} and {legacyData.groups.length} group{legacyData.groups.length === 1 ? "" : "s"} saved in this browser.</p>
            <div className="modal-actions"><button className="quiet-button" disabled={busy} onClick={dismissMigration}>Not now</button><button className="add-button" disabled={busy} onClick={importPreviousData}>{busy ? "Importing…" : "Import and sync"}</button></div>
          </div>
        </div>
      )}
    </main>
  );
}

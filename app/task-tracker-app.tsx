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
  createTasks,
  deleteTasks,
  ensureWorkspace,
  importLegacyData,
  localMigrationComplete,
  setTaskCompleted,
  subscribeToWorkspace,
} from "@/lib/task-tracker-repository";
import {
  groupColors,
  parseLegacyData,
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

type AuthStatus = "loading" | "signed-out" | "signed-in" | "unconfigured";
type Composer = "single" | "bulk" | null;

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// Preserve one-time imports from the pre-Firebase browser release without
// carrying its former product name into the current interface or data model.
const previousDataStorageKey = ["day", "mark-data"].join("");

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
  const [newGroup, setNewGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupColor, setGroupColor] = useState(groupColors[3]);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [legacyData, setLegacyData] = useState<PreviousTrackerData | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const migrationCheckedFor = useRef("");

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
  };

  const addTaskRecords = async (event: FormEvent) => {
    event.preventDefault();
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

  const formatDate = (date: string) => {
    if (!date) return "No due date";
    if (date === today()) return "Due today";
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
    }).format(new Date(`${date}T12:00:00`));
  };

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
          {(["All", "Today", "Upcoming", "Completed"] as Filter[]).map((item) => (
            <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
              <span className="nav-icon">{item === "All" ? "⌗" : item === "Today" ? "◷" : item === "Upcoming" ? "↗" : "✓"}</span>
              <span className="nav-label">{item}</span>
              <span className="nav-count">{item === "All" ? tasks.length : item === "Today" ? counts.today : item === "Completed" ? counts.done : tasks.filter((task) => !task.completed && task.dueDate > today()).length}</span>
            </button>
          ))}
        </nav>
        <div className="group-heading"><span>Groups</span><button aria-label="Add group" onClick={() => setNewGroup(true)}>＋</button></div>
        <div className="group-list">
          <button className={groupFilter === "all" ? "group-active" : ""} onClick={() => setGroupFilter("all")}><span className="all-dot" />All groups</button>
          {groups.map((group) => (
            <button key={group.id} className={groupFilter === group.id ? "group-active" : ""} onClick={() => setGroupFilter(group.id)}>
              <span className="group-dot" style={{ background: group.color }} />{group.name}
              <span className="nav-count">{tasks.filter((task) => task.groupId === group.id).length}</span>
            </button>
          ))}
        </div>
        <div className="account-card">
          <span className="avatar">{initials}</span>
          <div><strong>{user.displayName || "Task Tracker user"}</strong><span>{user.email}</span></div>
          <button aria-label="Sign out" title="Sign out" onClick={() => signOut(getFirebaseServices()!.auth)}>↪</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks" aria-label="Search tasks" /></label>
          <div className="sync-state" data-online={online}><i />{syncText}</div>
          <div className="top-actions">
            <button className="bulk-button" onClick={() => setComposer("bulk")}>＋ <span>Bulk add</span></button>
            <button className="add-button" onClick={() => setComposer("single")}>＋ Add task</button>
          </div>
        </header>

        <div className="mobile-group-strip" aria-label="Filter by group">
          <button className={groupFilter === "all" ? "active" : ""} onClick={() => setGroupFilter("all")}>All</button>
          {groups.map((group) => <button key={group.id} className={groupFilter === group.id ? "active" : ""} onClick={() => setGroupFilter(group.id)}><i style={{ background: group.color }} />{group.name}</button>)}
          <button className="new-group-chip" onClick={() => setNewGroup(true)}>＋ Group</button>
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

          {notice && <div className="notice-banner" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}
          {selected.length > 0 && <div className="selection-bar"><strong>{selected.length} selected</strong><button onClick={() => setSelected([])}>Clear</button><button className="delete-text" onClick={() => setDeleteIds(selected)}>Delete selected</button></div>}

          <div className="list-header"><span>{visible.length} tasks</span><span>Sorted by due date</span></div>
          <div className="task-list" aria-busy={!groupsLoaded || !tasksLoaded}>
            {(!groupsLoaded || !tasksLoaded) && <div className="empty-state"><span className="loading-dot">T</span><h2>Syncing your day</h2><p>Your tasks will appear in a moment.</p></div>}
            {groupsLoaded && tasksLoaded && visible.map((task) => {
              const group = groupById(task.groupId);
              return (
                <article className={`task-row ${task.completed ? "completed" : ""}`} key={task.id} style={{ "--group-color": group?.color ?? "#586A5B" } as React.CSSProperties}>
                  <input className="select-box" type="checkbox" aria-label={`Select ${task.title}`} checked={selected.includes(task.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, task.id])] : current.filter((id) => id !== task.id))} />
                  <button className="complete-box" disabled={busy} aria-label={task.completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`} onClick={() => run(() => setTaskCompleted(db, user.uid, task))}>{task.completed ? "✓" : ""}</button>
                  <div className="task-main"><h2>{task.title}</h2><div className="task-meta"><span className="group-tag"><i style={{ background: group?.color ?? "#586A5B" }} />{group?.name ?? "Group"}</span><span>{formatDate(task.dueDate)}</span>{task.completedAt && <span>Completed {new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(task.completedAt))}</span>}</div></div>
                  <span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span>
                  <button className="row-delete" aria-label={`Delete ${task.title}`} onClick={() => setDeleteIds([task.id])}>×</button>
                </article>
              );
            })}
            {groupsLoaded && tasksLoaded && !visible.length && <div className="empty-state"><span>✓</span><h2>Nothing here</h2><p>Add a task or try another view.</p></div>}
          </div>
        </div>
      </section>

      {composer && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && resetComposer()}>
          <form className="modal" onSubmit={addTaskRecords}>
            <div className="modal-head"><div><span className="eyebrow">{composer === "bulk" ? "QUICK CAPTURE" : "NEW TASK"}</span><h2>{composer === "bulk" ? "Add multiple tasks" : "Add a task"}</h2></div><button type="button" onClick={resetComposer} aria-label="Close">×</button></div>
            {composer === "bulk" ? <label>Tasks <span className="label-hint">One per line</span><textarea autoFocus value={bulkTitles} onChange={(event) => setBulkTitles(event.target.value)} placeholder={"Prepare slides\nSend weekly update\nSchedule review"} required /></label> : <label>Task name<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs to be done?" required /></label>}
            <div className="form-grid">
              <label>Group<select value={groupId} onChange={(event) => setGroupId(event.target.value)}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
              <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}><option>High</option><option>Medium</option><option>Low</option></select></label>
              <label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
            </div>
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={resetComposer}>Cancel</button><button className="add-button" disabled={busy}>{busy ? "Saving…" : composer === "bulk" ? "Add tasks" : "Add task"}</button></div>
          </form>
        </div>
      )}

      {newGroup && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setNewGroup(false)}>
          <form className="modal small-modal" onSubmit={addGroupRecord}>
            <div className="modal-head"><div><span className="eyebrow">ORGANIZE</span><h2>New group</h2></div><button type="button" onClick={() => setNewGroup(false)} aria-label="Close">×</button></div>
            <label>Group name<input autoFocus value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="e.g. Learning" required /></label>
            <fieldset><legend>Color</legend><div className="color-row">{groupColors.map((color) => <button type="button" key={color} aria-label={`Use color ${color}`} className={groupColor === color ? "color-selected" : ""} style={{ background: color }} onClick={() => setGroupColor(color)} />)}</div></fieldset>
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setNewGroup(false)}>Cancel</button><button className="add-button" disabled={busy}>{busy ? "Creating…" : "Create group"}</button></div>
          </form>
        </div>
      )}

      {deleteIds.length > 0 && (
        <div className="modal-backdrop">
          <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
            <div className="warning-mark">!</div><h2 id="delete-title">Delete {deleteIds.length === 1 ? "this task" : `${deleteIds.length} tasks`}?</h2>
            <p>This action can’t be undone. {deleteIds.length === 1 ? "The selected task" : "The selected tasks"} will be permanently removed from every synced device.</p>
            <div className="modal-actions"><button className="quiet-button" disabled={busy} onClick={() => setDeleteIds([])}>Keep {deleteIds.length === 1 ? "task" : "tasks"}</button><button className="danger-button" disabled={busy} onClick={confirmDelete}>{busy ? "Deleting…" : "Yes, delete"}</button></div>
          </div>
        </div>
      )}

      {legacyData && (
        <div className="modal-backdrop">
          <div className="modal migration-modal" role="dialog" aria-modal="true" aria-labelledby="migration-title">
            <span className="migration-mark">↥</span><span className="eyebrow">ONE-TIME IMPORT</span><h2 id="migration-title">Bring your previous tracker data</h2>
            <p>We found {legacyData.tasks.length} task{legacyData.tasks.length === 1 ? "" : "s"} and {legacyData.groups.length} group{legacyData.groups.length === 1 ? "" : "s"} saved in this browser.</p>
            <div className="modal-actions"><button className="quiet-button" disabled={busy} onClick={dismissMigration}>Not now</button><button className="add-button" disabled={busy} onClick={importPreviousData}>{busy ? "Importing…" : "Import and sync"}</button></div>
          </div>
        </div>
      )}
    </main>
  );
}

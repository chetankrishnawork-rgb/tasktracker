"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Priority = "High" | "Medium" | "Low";
type Filter = "All" | "Today" | "Upcoming" | "Completed";
type Group = { id: string; name: string; color: string };
type Task = {
  id: string;
  title: string;
  groupId: string;
  priority: Priority;
  dueDate: string;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
};

const groupSeeds: Group[] = [
  { id: "work", name: "Work", color: "#586A5B" },
  { id: "personal", name: "Personal", color: "#C4795A" },
  { id: "health", name: "Health", color: "#7886A3" },
];

const taskSeeds: Task[] = [
  { id: "1", title: "Review project brief", groupId: "work", priority: "High", dueDate: new Date().toISOString().slice(0, 10), completed: false, completedAt: null, createdAt: new Date().toISOString() },
  { id: "2", title: "Book dentist appointment", groupId: "personal", priority: "Medium", dueDate: "", completed: false, completedAt: null, createdAt: new Date().toISOString() },
  { id: "3", title: "30-minute evening walk", groupId: "health", priority: "Low", dueDate: new Date().toISOString().slice(0, 10), completed: true, completedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
];

const colors = ["#586A5B", "#C4795A", "#7886A3", "#A87B45", "#8C6F89", "#4F7C79"];

const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const today = () => new Date().toISOString().slice(0, 10);

export default function Home() {
  const [groups, setGroups] = useState<Group[]>(groupSeeds);
  const [tasks, setTasks] = useState<Task[]>(taskSeeds);
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<Filter>("All");
  const [groupFilter, setGroupFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [composer, setComposer] = useState<"single" | "bulk" | null>(null);
  const [title, setTitle] = useState("");
  const [bulkTitles, setBulkTitles] = useState("");
  const [groupId, setGroupId] = useState("work");
  const [priority, setPriority] = useState<Priority>("Medium");
  const [dueDate, setDueDate] = useState(today());
  const [newGroup, setNewGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupColor, setGroupColor] = useState(colors[3]);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("daymark-data");
      if (saved) {
        const parsed = JSON.parse(saved);
        setTasks(parsed.tasks ?? taskSeeds);
        setGroups(parsed.groups ?? groupSeeds);
      }
    } catch {}
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem("daymark-data", JSON.stringify({ tasks, groups }));
  }, [tasks, groups, ready]);

  const counts = useMemo(() => ({
    total: tasks.filter((t) => !t.completed).length,
    today: tasks.filter((t) => !t.completed && t.dueDate === today()).length,
    done: tasks.filter((t) => t.completed).length,
  }), [tasks]);

  const visible = useMemo(() => {
    return tasks
      .filter((task) => groupFilter === "all" || task.groupId === groupFilter)
      .filter((task) => task.title.toLowerCase().includes(query.toLowerCase()))
      .filter((task) => {
        if (filter === "Today") return !task.completed && task.dueDate === today();
        if (filter === "Upcoming") return !task.completed && Boolean(task.dueDate) && task.dueDate > today();
        if (filter === "Completed") return task.completed;
        return true;
      })
      .sort((a, b) => Number(a.completed) - Number(b.completed) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  }, [tasks, groupFilter, query, filter]);

  const groupById = (id: string) => groups.find((group) => group.id === id) ?? groups[0];
  const resetComposer = () => { setComposer(null); setTitle(""); setBulkTitles(""); };

  const addTasks = (event: FormEvent) => {
    event.preventDefault();
    const titles = composer === "bulk"
      ? bulkTitles.split("\n").map((item) => item.trim()).filter(Boolean)
      : [title.trim()].filter(Boolean);
    if (!titles.length) return;
    const stamp = new Date().toISOString();
    setTasks((current) => [
      ...titles.map((item) => ({ id: uid(), title: item, groupId, priority, dueDate, completed: false, completedAt: null, createdAt: stamp } as Task)),
      ...current,
    ]);
    resetComposer();
  };

  const addGroup = (event: FormEvent) => {
    event.preventDefault();
    if (!groupName.trim()) return;
    const group = { id: uid(), name: groupName.trim(), color: groupColor };
    setGroups((current) => [...current, group]);
    setGroupId(group.id);
    setGroupName("");
    setNewGroup(false);
  };

  const toggleTask = (id: string) => {
    setTasks((current) => current.map((task) => task.id === id ? {
      ...task,
      completed: !task.completed,
      completedAt: task.completed ? null : new Date().toISOString(),
    } : task));
  };

  const confirmDelete = () => {
    setTasks((current) => current.filter((task) => !deleteIds.includes(task.id)));
    setSelected((current) => current.filter((id) => !deleteIds.includes(id)));
    setDeleteIds([]);
  };

  const formatDate = (date: string) => {
    if (!date) return "No due date";
    if (date === today()) return "Due today";
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`));
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">D</span><span>Daymark</span></div>
        <nav className="main-nav" aria-label="Task views">
          {(["All", "Today", "Upcoming", "Completed"] as Filter[]).map((item) => (
            <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
              <span className="nav-icon">{item === "All" ? "⌗" : item === "Today" ? "◷" : item === "Upcoming" ? "↗" : "✓"}</span>
              {item}<span className="nav-count">{item === "All" ? tasks.length : item === "Today" ? counts.today : item === "Completed" ? counts.done : tasks.filter((t) => !t.completed && t.dueDate > today()).length}</span>
            </button>
          ))}
        </nav>
        <div className="group-heading"><span>Groups</span><button aria-label="Add group" onClick={() => setNewGroup(true)}>＋</button></div>
        <div className="group-list">
          <button className={groupFilter === "all" ? "group-active" : ""} onClick={() => setGroupFilter("all")}><span className="all-dot" />All groups</button>
          {groups.map((group) => (
            <button key={group.id} className={groupFilter === group.id ? "group-active" : ""} onClick={() => setGroupFilter(group.id)}>
              <span className="group-dot" style={{ background: group.color }} />{group.name}
              <span className="nav-count">{tasks.filter((t) => t.groupId === group.id).length}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-note"><span>Tip</span> Add a few tasks at once with Bulk add.</div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <label className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks" aria-label="Search tasks" /></label>
          <div className="top-actions">
            <button className="bulk-button" onClick={() => setComposer("bulk")}>＋ Bulk add</button>
            <button className="add-button" onClick={() => setComposer("single")}>＋ Add task</button>
          </div>
        </header>

        <div className="content">
          <div className="date-kicker">{new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</div>
          <div className="title-row">
            <div><h1>{filter === "All" ? "My day" : filter}</h1><p>{counts.today ? `${counts.today} task${counts.today === 1 ? "" : "s"} due today` : "A clear day ahead"}</p></div>
            <div className="progress-ring" style={{ "--progress": `${tasks.length ? Math.round((counts.done / tasks.length) * 100) : 0}%` } as React.CSSProperties}>
              <div><strong>{tasks.length ? Math.round((counts.done / tasks.length) * 100) : 0}%</strong><span>done</span></div>
            </div>
          </div>

          <div className="summary-strip">
            <div><strong>{counts.total}</strong><span>Open tasks</span></div>
            <div><strong>{counts.today}</strong><span>Due today</span></div>
            <div><strong>{counts.done}</strong><span>Completed</span></div>
          </div>

          {selected.length > 0 && (
            <div className="selection-bar"><strong>{selected.length} selected</strong><button onClick={() => setSelected([])}>Clear</button><button className="delete-text" onClick={() => setDeleteIds(selected)}>Delete selected</button></div>
          )}

          <div className="list-header"><span>{visible.length} tasks</span><span>Sorted by due date</span></div>
          <div className="task-list">
            {visible.map((task) => {
              const group = groupById(task.groupId);
              return (
                <article className={`task-row ${task.completed ? "completed" : ""}`} key={task.id} style={{ "--group-color": group.color } as React.CSSProperties}>
                  <input className="select-box" type="checkbox" aria-label={`Select ${task.title}`} checked={selected.includes(task.id)} onChange={(e) => setSelected((current) => e.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))} />
                  <button className="complete-box" aria-label={task.completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`} onClick={() => toggleTask(task.id)}>{task.completed ? "✓" : ""}</button>
                  <div className="task-main"><h2>{task.title}</h2><div className="task-meta"><span className="group-tag"><i style={{ background: group.color }} />{group.name}</span><span>{formatDate(task.dueDate)}</span>{task.completedAt && <span>Completed {formatDate(task.completedAt.slice(0, 10)).replace("Due ", "")}</span>}</div></div>
                  <span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span>
                  <button className="row-delete" aria-label={`Delete ${task.title}`} onClick={() => setDeleteIds([task.id])}>×</button>
                </article>
              );
            })}
            {!visible.length && <div className="empty-state"><span>✓</span><h2>Nothing here</h2><p>Add a task or try another view.</p></div>}
          </div>
        </div>
      </section>

      {composer && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && resetComposer()}>
          <form className="modal" onSubmit={addTasks}>
            <div className="modal-head"><div><span className="eyebrow">{composer === "bulk" ? "QUICK CAPTURE" : "NEW TASK"}</span><h2>{composer === "bulk" ? "Add multiple tasks" : "Add a task"}</h2></div><button type="button" onClick={resetComposer} aria-label="Close">×</button></div>
            {composer === "bulk" ? <label>Tasks <span className="label-hint">One per line</span><textarea autoFocus value={bulkTitles} onChange={(e) => setBulkTitles(e.target.value)} placeholder={"Prepare slides\nSend weekly update\nSchedule review"} required /></label> : <label>Task name<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" required /></label>}
            <div className="form-grid">
              <label>Group<select value={groupId} onChange={(e) => setGroupId(e.target.value)}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
              <label>Priority<select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}><option>High</option><option>Medium</option><option>Low</option></select></label>
              <label>Due date<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
            </div>
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={resetComposer}>Cancel</button><button className="add-button" type="submit">{composer === "bulk" ? "Add tasks" : "Add task"}</button></div>
          </form>
        </div>
      )}

      {newGroup && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setNewGroup(false)}>
          <form className="modal small-modal" onSubmit={addGroup}>
            <div className="modal-head"><div><span className="eyebrow">ORGANIZE</span><h2>New group</h2></div><button type="button" onClick={() => setNewGroup(false)} aria-label="Close">×</button></div>
            <label>Group name<input autoFocus value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="e.g. Learning" required /></label>
            <fieldset><legend>Color</legend><div className="color-row">{colors.map((color) => <button type="button" key={color} aria-label={`Use color ${color}`} className={groupColor === color ? "color-selected" : ""} style={{ background: color }} onClick={() => setGroupColor(color)} />)}</div></fieldset>
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setNewGroup(false)}>Cancel</button><button className="add-button" type="submit">Create group</button></div>
          </form>
        </div>
      )}

      {deleteIds.length > 0 && (
        <div className="modal-backdrop">
          <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
            <div className="warning-mark">!</div><h2 id="delete-title">Delete {deleteIds.length === 1 ? "this task" : `${deleteIds.length} tasks`}?</h2>
            <p>This action can’t be undone. {deleteIds.length === 1 ? "The selected task" : "The selected tasks"} will be permanently removed.</p>
            <div className="modal-actions"><button className="quiet-button" onClick={() => setDeleteIds([])}>Keep {deleteIds.length === 1 ? "task" : "tasks"}</button><button className="danger-button" onClick={confirmDelete}>Yes, delete</button></div>
          </div>
        </div>
      )}
    </main>
  );
}

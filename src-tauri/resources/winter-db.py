#!/usr/bin/env python3
"""winter-db.py — Winter's SQLite memory index. stdlib only."""

import sqlite3
import json
import argparse
import sys
import os
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "winter.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            taskinfo_path TEXT,
            summary TEXT
        );
        CREATE TABLE IF NOT EXISTS agent_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT,
            agent TEXT NOT NULL,
            action TEXT NOT NULL,
            result TEXT DEFAULT 'pending',
            session_id TEXT,
            started_at TEXT DEFAULT (datetime('now')),
            completed_at TEXT,
            notes TEXT,
            FOREIGN KEY (task_id) REFERENCES tasks(id)
        );
        CREATE TABLE IF NOT EXISTS errors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern TEXT NOT NULL,
            context TEXT,
            solution TEXT,
            occurrences INTEGER DEFAULT 1,
            first_seen TEXT DEFAULT (datetime('now')),
            last_seen TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS context_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            active_tasks TEXT,
            current_work TEXT,
            pending_items TEXT,
            notes TEXT
        );
    """)
    conn.commit()


# ── tasks ──────────────────────────────────────────────────────────────────

def cmd_tasks(args):
    conn = get_conn()
    init_db(conn)
    if args.all:
        rows = conn.execute("SELECT id,status,title,summary FROM tasks ORDER BY updated_at DESC").fetchall()
    elif args.status:
        rows = conn.execute("SELECT id,status,title,summary FROM tasks WHERE status=? ORDER BY updated_at DESC", (args.status,)).fetchall()
    else:
        rows = conn.execute("SELECT id,status,title,summary FROM tasks WHERE status='active' ORDER BY updated_at DESC").fetchall()
    if not rows:
        print("no tasks")
        return
    for r in rows:
        summary = f" | {r['summary']}" if r['summary'] else ""
        print(f"[{r['status']}] {r['id']}: {r['title']}{summary}")


def cmd_task_add(args):
    if not args.id.strip():
        print("error: id cannot be empty", file=sys.stderr)
        sys.exit(1)
    conn = get_conn()
    init_db(conn)
    try:
        conn.execute(
            "INSERT INTO tasks (id,title,summary,taskinfo_path) VALUES (?,?,?,?)",
            (args.id, args.title, args.summary, args.taskinfo_path)
        )
        conn.commit()
        print(f"task added: {args.id}")
    except sqlite3.IntegrityError:
        print(f"error: task '{args.id}' already exists. use task-update.", file=sys.stderr)
        sys.exit(1)


VALID_STATUSES = {'active', 'completed', 'paused', 'cancelled'}


def cmd_task_update(args):
    conn = get_conn()
    init_db(conn)
    fields = []
    vals = []
    if args.status:
        if args.status not in VALID_STATUSES:
            print(f"error: invalid status '{args.status}'. valid: {', '.join(sorted(VALID_STATUSES))}", file=sys.stderr)
            sys.exit(1)
        fields.append("status=?")
        vals.append(args.status)
    if args.summary is not None:
        fields.append("summary=?")
        vals.append(args.summary)
    if args.taskinfo_path is not None:
        fields.append("taskinfo_path=?")
        vals.append(args.taskinfo_path)
    if not fields:
        print("error: nothing to update", file=sys.stderr)
        sys.exit(1)
    fields.append("updated_at=datetime('now')")
    vals.append(args.id)
    cur = conn.execute(f"UPDATE tasks SET {','.join(fields)} WHERE id=?", vals)
    conn.commit()
    if cur.rowcount == 0:
        print(f"error: task '{args.id}' not found", file=sys.stderr)
        sys.exit(1)
    print(f"task updated: {args.id}")


# ── agent_runs ─────────────────────────────────────────────────────────────

def cmd_log_run(args):
    conn = get_conn()
    init_db(conn)
    completed_at = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S') if args.result and args.result != 'pending' else None
    try:
        conn.execute(
            "INSERT INTO agent_runs (task_id,agent,action,result,session_id,completed_at,notes) VALUES (?,?,?,?,?,?,?)",
            (args.task_id, args.agent, args.action, args.result or 'pending', args.session_id, completed_at, args.notes)
        )
        conn.commit()
    except sqlite3.IntegrityError:
        print(f"error: task '{args.task_id}' not found", file=sys.stderr)
        sys.exit(1)
    print(f"run logged: {args.agent} / {args.action} / {args.result or 'pending'}")


def cmd_runs(args):
    conn = get_conn()
    init_db(conn)
    where = []
    vals = []
    if args.agent:
        where.append("agent=?")
        vals.append(args.agent)
    if args.task_id:
        where.append("task_id=?")
        vals.append(args.task_id)
    if args.result:
        where.append("result=?")
        vals.append(args.result)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    rows = conn.execute(
        f"SELECT id,agent,action,result,task_id,session_id,started_at,notes FROM agent_runs {clause} ORDER BY id DESC LIMIT 10",
        vals
    ).fetchall()
    if not rows:
        print("no runs")
        return
    for r in rows:
        task = f"[{r['task_id']}]" if r['task_id'] else ""
        notes = f" | {r['notes']}" if r['notes'] else ""
        print(f"#{r['id']} {r['agent']} {task} {r['action']} → {r['result']} ({r['started_at'][:10]}){notes}")


# ── errors ─────────────────────────────────────────────────────────────────

def cmd_error_add(args):
    conn = get_conn()
    init_db(conn)
    existing = conn.execute("SELECT id,occurrences FROM errors WHERE pattern=?", (args.pattern,)).fetchone()
    if existing:
        conn.execute(
            "UPDATE errors SET occurrences=occurrences+1, last_seen=datetime('now'), context=COALESCE(?,context), solution=COALESCE(?,solution) WHERE id=?",
            (args.context, args.solution, existing['id'])
        )
        conn.commit()
        print(f"error updated (occurrences={existing['occurrences']+1}): {args.pattern}")
    else:
        conn.execute(
            "INSERT INTO errors (pattern,context,solution) VALUES (?,?,?)",
            (args.pattern, args.context, args.solution)
        )
        conn.commit()
        print(f"error added: {args.pattern}")


def cmd_errors(args):
    conn = get_conn()
    init_db(conn)
    if args.recent:
        rows = conn.execute(
            "SELECT id,pattern,context,solution,occurrences,last_seen FROM errors ORDER BY last_seen DESC LIMIT ?",
            (args.recent,)
        ).fetchall()
    elif args.query:
        rows = conn.execute(
            "SELECT id,pattern,context,solution,occurrences,last_seen FROM errors WHERE pattern LIKE ? OR context LIKE ? OR solution LIKE ? ORDER BY occurrences DESC",
            (f"%{args.query}%", f"%{args.query}%", f"%{args.query}%")
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id,pattern,context,solution,occurrences,last_seen FROM errors ORDER BY occurrences DESC LIMIT 10"
        ).fetchall()
    if not rows:
        print("no errors")
        return
    for r in rows:
        ctx = f" [{r['context']}]" if r['context'] else ""
        sol = f" → {r['solution']}" if r['solution'] else ""
        print(f"#{r['id']} x{r['occurrences']}{ctx} {r['pattern']}{sol}")


# ── context_snapshots ──────────────────────────────────────────────────────

def cmd_snapshot_save(args):
    conn = get_conn()
    init_db(conn)
    active_tasks = args.active_tasks
    if active_tasks:
        try:
            json.loads(active_tasks)
        except json.JSONDecodeError:
            print("error: --active-tasks must be valid JSON array", file=sys.stderr)
            sys.exit(1)
    conn.execute(
        "INSERT INTO context_snapshots (session_id,active_tasks,current_work,pending_items,notes) VALUES (?,?,?,?,?)",
        (args.session_id, active_tasks, args.current_work, args.pending, args.notes)
    )
    conn.commit()
    print(f"snapshot saved: session={args.session_id}")


def _print_snapshot(r):
    if not r:
        print("no snapshot")
        return
    print(f"snapshot #{r['id']} @ {r['created_at'][:16]} session={r['session_id']}")
    if r['active_tasks']:
        tasks = json.loads(r['active_tasks'])
        print(f"  active: {', '.join(tasks)}")
    if r['current_work']:
        print(f"  work: {r['current_work']}")
    if r['pending_items']:
        print(f"  pending: {r['pending_items']}")
    if r['notes']:
        print(f"  notes: {r['notes']}")


def cmd_snapshot_latest(args):
    conn = get_conn()
    init_db(conn)
    r = conn.execute("SELECT * FROM context_snapshots ORDER BY id DESC LIMIT 1").fetchone()
    _print_snapshot(r)


def cmd_snapshot(args):
    conn = get_conn()
    init_db(conn)
    r = conn.execute("SELECT * FROM context_snapshots WHERE session_id=? ORDER BY id DESC LIMIT 1", (args.session_id,)).fetchone()
    _print_snapshot(r)


# ── recover ────────────────────────────────────────────────────────────────

def cmd_recover(args):
    """One-shot context recovery. Compact output < 500 tokens."""
    conn = get_conn()
    init_db(conn)

    # active tasks
    tasks = conn.execute("SELECT id,title,summary FROM tasks WHERE status='active' ORDER BY updated_at DESC").fetchall()
    print("=TASKS")
    if tasks:
        for t in tasks:
            s = f" {t['summary']}" if t['summary'] else ""
            print(f"  {t['id']}: {t['title']}{s}")
    else:
        print("  none")

    # latest snapshot
    snap = conn.execute("SELECT * FROM context_snapshots ORDER BY id DESC LIMIT 1").fetchone()
    print("=SNAPSHOT")
    if snap:
        print(f"  session={snap['session_id']} at={snap['created_at'][:16]}")
        if snap['current_work']:
            print(f"  work: {snap['current_work']}")
        if snap['pending_items']:
            print(f"  pending: {snap['pending_items']}")
        if snap['notes']:
            print(f"  notes: {snap['notes']}")
    else:
        print("  none")

    # last 5 agent runs
    runs = conn.execute("SELECT agent,action,result,task_id,started_at FROM agent_runs ORDER BY id DESC LIMIT 5").fetchall()
    print("=RUNS")
    if runs:
        for r in runs:
            task = f"[{r['task_id']}]" if r['task_id'] else ""
            print(f"  {r['agent']} {task} {r['action']} → {r['result']} ({r['started_at'][:10]})")
    else:
        print("  none")

    # recent errors (last 3)
    errors = conn.execute("SELECT pattern,solution,occurrences FROM errors ORDER BY last_seen DESC LIMIT 3").fetchall()
    print("=ERRORS")
    if errors:
        for e in errors:
            sol = f" → {e['solution']}" if e['solution'] else ""
            print(f"  x{e['occurrences']} {e['pattern']}{sol}")
    else:
        print("  none")


# ── CLI setup ──────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(prog="winter-db.py", description="Winter's structured memory CLI")
    sub = p.add_subparsers(dest="cmd", required=True)

    # tasks
    p_tasks = sub.add_parser("tasks", help="list tasks")
    p_tasks.add_argument("--all", action="store_true")
    p_tasks.add_argument("--status")

    # task-add
    p_ta = sub.add_parser("task-add", help="add a task")
    p_ta.add_argument("id")
    p_ta.add_argument("title")
    p_ta.add_argument("--summary")
    p_ta.add_argument("--taskinfo-path")

    # task-update
    p_tu = sub.add_parser("task-update", help="update a task")
    p_tu.add_argument("id")
    p_tu.add_argument("--status")
    p_tu.add_argument("--summary")
    p_tu.add_argument("--taskinfo-path")

    # log-run
    p_lr = sub.add_parser("log-run", help="log an agent run")
    p_lr.add_argument("--agent", required=True)
    p_lr.add_argument("--action", required=True)
    p_lr.add_argument("--task-id")
    p_lr.add_argument("--result", default="pending")
    p_lr.add_argument("--session-id")
    p_lr.add_argument("--notes")

    # runs
    p_runs = sub.add_parser("runs", help="query agent runs")
    p_runs.add_argument("--agent")
    p_runs.add_argument("--task-id")
    p_runs.add_argument("--result")

    # error-add
    p_ea = sub.add_parser("error-add", help="log an error pattern")
    p_ea.add_argument("--pattern", required=True)
    p_ea.add_argument("--context")
    p_ea.add_argument("--solution")

    # errors
    p_errs = sub.add_parser("errors", help="search errors")
    p_errs.add_argument("query", nargs="?")
    p_errs.add_argument("--recent", type=int)

    # snapshot-save
    p_ss = sub.add_parser("snapshot-save", help="save context snapshot")
    p_ss.add_argument("--session-id")
    p_ss.add_argument("--current-work")
    p_ss.add_argument("--pending")
    p_ss.add_argument("--active-tasks")
    p_ss.add_argument("--notes")

    # snapshot-latest
    sub.add_parser("snapshot-latest", help="load latest snapshot")

    # snapshot
    p_snap = sub.add_parser("snapshot", help="load snapshot by session")
    p_snap.add_argument("--session-id", required=True)

    # recover
    sub.add_parser("recover", help="full context recovery dump")

    args = p.parse_args()

    dispatch = {
        "tasks": cmd_tasks,
        "task-add": cmd_task_add,
        "task-update": cmd_task_update,
        "log-run": cmd_log_run,
        "runs": cmd_runs,
        "error-add": cmd_error_add,
        "errors": cmd_errors,
        "snapshot-save": cmd_snapshot_save,
        "snapshot-latest": cmd_snapshot_latest,
        "snapshot": cmd_snapshot,
        "recover": cmd_recover,
    }
    dispatch[args.cmd](args)


if __name__ == "__main__":
    main()

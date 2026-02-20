/// Tauri-native cron scheduler with persistent registry.
/// Registry stored at: <app_data_dir>/scheduler-registry.json
/// Logs stored at:     <app_data_dir>/logs/<task-id>.log
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;
use tokio_cron_scheduler::{Job, JobScheduler};
use uuid::Uuid;

// ── Types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TaskCommand {
    pub script: String,
    pub args: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TaskEntry {
    pub id: String,
    pub name: String,
    pub schedule: String,
    pub command: TaskCommand,
    pub log_file: String,
    pub enabled: bool,
    pub created_by_user: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TaskRegistry {
    pub tasks: Vec<TaskEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TaskStatus {
    pub id: String,
    pub name: String,
    pub schedule: String,
    pub enabled: bool,
    pub created_by_user: bool,
    pub last_run: Option<String>,
    pub next_run: Option<String>,
    pub running: bool,
}

/// Shared Tauri state: scheduler + job UUID map + registry path.
/// Uses tokio::sync::Mutex so lock guards are Send across .await points.
pub struct SchedulerState {
    pub scheduler: JobScheduler,
    pub registry: TaskRegistry,
    pub job_map: HashMap<String, Uuid>,    // task_id → tokio-cron job uuid
    pub registry_path: PathBuf,
    pub data_dir: PathBuf,
    pub last_run: HashMap<String, String>, // task_id → ISO timestamp
    pub running: HashMap<String, bool>,    // task_id → running flag
}

pub type SharedSchedulerState = Arc<Mutex<Option<SchedulerState>>>;

/// Helper to extract the inner state or return an error if scheduler hasn't initialized yet.
pub async fn with_scheduler<F, R>(state: &SharedSchedulerState, f: F) -> Result<R, String>
where
    F: FnOnce(&mut SchedulerState) -> Result<R, String>,
{
    let mut guard = state.lock().await;
    match guard.as_mut() {
        Some(s) => f(s),
        None => Err("Scheduler is still initializing. Please try again.".to_string()),
    }
}

pub async fn start_enabled_jobs(state: &SharedSchedulerState) {
    let mut guard = state.lock().await;
    let Some(s) = guard.as_mut() else { return };
    let enabled: Vec<TaskEntry> = s.registry.tasks.iter().filter(|t| t.enabled).cloned().collect();
    let sched = s.scheduler.clone();
    let d_dir = s.data_dir.clone();
    drop(guard);

    for task in &enabled {
        let state_clone = state.clone();
        match add_job_to_scheduler(&sched, task, &d_dir, Some(&state_clone)).await {
            Ok(uuid) => {
                let mut g = state.lock().await;
                if let Some(s) = g.as_mut() {
                    s.job_map.insert(task.id.clone(), uuid);
                }
            }
            Err(e) => eprintln!("[scheduler] Failed to add job '{}' on init: {}", task.id, e),
        }
    }
}

// ── Default task seeds (13 crons from TaskInfo.md) ──────────────────

fn default_tasks() -> Vec<TaskEntry> {
    vec![
        TaskEntry {
            id: "phoenix".into(),
            name: "Phoenix Watchdog".into(),
            schedule: "* * * * *".into(),
            command: TaskCommand { script: "phoenix.sh".into(), args: vec![] },
            log_file: "phoenix-watchdog.log".into(),
            enabled: false,
            created_by_user: false,
        },
        TaskEntry {
            id: "log-digest".into(),
            name: "Log Digest".into(),
            schedule: "*/30 * * * *".into(),
            command: TaskCommand { script: "log-digest.sh".into(), args: vec![] },
            log_file: "log-digest.log".into(),
            enabled: false,
            created_by_user: false,
        },
        TaskEntry {
            id: "cleanup-sessions".into(),
            name: "Session Cleanup".into(),
            schedule: "*/30 * * * *".into(),
            command: TaskCommand { script: "cleanup-sessions.sh".into(), args: vec![] },
            log_file: "cleanup-sessions.log".into(),
            enabled: false,
            created_by_user: false,
        },
        TaskEntry {
            id: "incremental-backup".into(),
            name: "Incremental Backup".into(),
            schedule: "*/10 * * * *".into(),
            command: TaskCommand { script: "incremental-backup.sh".into(), args: vec![] },
            log_file: "incremental-backup.log".into(),
            enabled: false,
            created_by_user: false,
        },
        TaskEntry {
            id: "audit-collect".into(),
            name: "Audit Collector".into(),
            schedule: "0 * * * *".into(),
            command: TaskCommand { script: "collect-logs.sh".into(), args: vec![] },
            log_file: "audit-collect.log".into(),
            enabled: false,
            created_by_user: false,
        },
        TaskEntry {
            id: "rag-indexer".into(),
            name: "RAG Indexer".into(),
            schedule: "0 */6 * * *".into(),
            command: TaskCommand { script: "rag-indexer.py".into(), args: vec![] },
            log_file: "rag-indexer.log".into(),
            enabled: false,
            created_by_user: false,
        },
        TaskEntry {
            id: "daily-backup".into(),
            name: "Daily Backup".into(),
            schedule: "0 4 * * *".into(),
            command: TaskCommand { script: "openclaw-backup.sh".into(), args: vec![] },
            log_file: "daily-backup.log".into(),
            enabled: false,
            created_by_user: false,
        },
        TaskEntry {
            id: "daily-cleanup".into(),
            name: "Disk Cleanup".into(),
            schedule: "0 5 * * *".into(),
            command: TaskCommand { script: "daily-cleanup.sh".into(), args: vec![] },
            log_file: "daily-cleanup.log".into(),
            enabled: false,
            created_by_user: false,
        },
        TaskEntry {
            id: "daily-avatar".into(),
            name: "Avatar Update".into(),
            schedule: "0 9 * * *".into(),
            command: TaskCommand { script: "daily-avatar.sh".into(), args: vec![] },
            log_file: "daily-avatar.log".into(),
            enabled: false,
            created_by_user: false,
        },
        TaskEntry {
            id: "daily-obsidian".into(),
            name: "Obsidian Log".into(),
            schedule: "59 23 * * *".into(),
            command: TaskCommand { script: "daily-obsidian-log.sh".into(), args: vec![] },
            log_file: "daily-obsidian.log".into(),
            enabled: false,
            created_by_user: false,
        },
        TaskEntry {
            id: "deadline-checker".into(),
            name: "Deadline Checker".into(),
            schedule: "0 8-22/2 * * *".into(),
            command: TaskCommand { script: "deadline-checker.py".into(), args: vec![] },
            log_file: "deadline-checker.log".into(),
            enabled: false,
            created_by_user: false,
        },
        TaskEntry {
            id: "ai-upgrade-scanner".into(),
            name: "Upgrade Scanner".into(),
            schedule: "0 9,21 * * *".into(),
            command: TaskCommand { script: "ai-upgrade-scanner.py".into(), args: vec![] },
            log_file: "ai-upgrade-scanner.log".into(),
            enabled: false,
            created_by_user: false,
        },
        TaskEntry {
            id: "study-sync".into(),
            name: "Study Sync".into(),
            schedule: "0 8-22/2 * * *".into(),
            command: TaskCommand { script: "sync_to_cloud.sh".into(), args: vec![] },
            log_file: "study-sync.log".into(),
            enabled: false,
            created_by_user: false,
        },
    ]
}

// ── Registry I/O ─────────────────────────────────────────────────────

fn registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {}", e))?;
    Ok(data_dir.join("scheduler-registry.json"))
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {}", e))
}

fn read_registry(path: &PathBuf) -> TaskRegistry {
    match std::fs::read_to_string(path) {
        Ok(s) => match serde_json::from_str(&s) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[scheduler] Corrupt registry at {:?}: {}. Backing up and resetting.", path, e);
                let bak = path.with_extension("json.corrupt");
                let _ = std::fs::rename(path, &bak);
                TaskRegistry::default()
            }
        },
        Err(_) => TaskRegistry::default(),
    }
}

fn write_registry(path: &PathBuf, registry: &TaskRegistry) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create registry dir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(registry)
        .map_err(|e| format!("Failed to serialize registry: {}", e))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json).map_err(|e| format!("Failed to write temp registry: {}", e))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("Failed to commit registry: {}", e))
}

// ── Script resolution ─────────────────────────────────────────────────

fn resolve_script(script_name: &str) -> Result<PathBuf, String> {
    if script_name.contains('/') || script_name.contains('\\') || script_name.contains("..") || script_name.is_empty() {
        return Err(format!("Invalid script name '{}': must be a plain filename", script_name));
    }

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Cannot determine home directory".to_string())?;

    let candidates = [
        PathBuf::from(&home).join("bin").join(script_name),
        PathBuf::from(&home).join("infra").join(script_name),
    ];

    for candidate in &candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "Script '{}' not found in ~/bin/ or ~/infra/",
        script_name
    ))
}

// ── Linux crontab migration ───────────────────────────────────────────

#[cfg(target_os = "linux")]
fn read_active_cron_ids() -> Vec<String> {
    let output = std::process::Command::new("crontab").arg("-l").output();
    match output {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout);
            let defaults = default_tasks();
            let mut ids = Vec::new();
            for line in text.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                for task in &defaults {
                    if trimmed.contains(&*task.command.script) {
                        ids.push(task.id.clone());
                    }
                }
            }
            ids
        }
        _ => vec![],
    }
}

#[cfg(not(target_os = "linux"))]
fn read_active_cron_ids() -> Vec<String> {
    vec![]
}

// ── Logging ───────────────────────────────────────────────────────────

fn log_path(data_dir: &Path, task_id: &str) -> PathBuf {
    data_dir.join("logs").join(format!("{}.log", task_id))
}

fn append_log(log_file: &PathBuf, message: &str) {
    if let Some(parent) = log_file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file)
    {
        let ts = Local::now().format("%Y-%m-%d %H:%M:%S");
        let _ = writeln!(f, "[{}] {}", ts, message);
    }
}

// ── Scheduler initialization ──────────────────────────────────────────

pub async fn init_scheduler(app: &AppHandle) -> Result<SchedulerState, String> {
    let reg_path = registry_path(app)?;
    let d_dir = data_dir(app)?;

    let registry = if reg_path.exists() {
        read_registry(&reg_path)
    } else {
        let mut r = TaskRegistry { tasks: default_tasks() };
        let active = read_active_cron_ids();
        for task in &mut r.tasks {
            if active.contains(&task.id) {
                task.enabled = true;
            }
        }
        write_registry(&reg_path, &r)?;
        r
    };

    let sched = JobScheduler::new()
        .await
        .map_err(|e| format!("Failed to create scheduler: {}", e))?;

    sched.start().await.map_err(|e| format!("Failed to start scheduler: {}", e))?;

    Ok(SchedulerState {
        scheduler: sched,
        registry,
        job_map: HashMap::new(),
        registry_path: reg_path,
        data_dir: d_dir,
        last_run: HashMap::new(),
        running: HashMap::new(),
    })
}

async fn add_job_to_scheduler(
    sched: &JobScheduler,
    task: &TaskEntry,
    data_dir: &Path,
    shared_state: Option<&SharedSchedulerState>,
) -> Result<Uuid, String> {
    let task_id = task.id.clone();
    let script_name = task.command.script.clone();
    let args = task.command.args.clone();
    let log_file = log_path(data_dir, &task_id);
    let state_ref = shared_state.cloned();

    let schedule_str = if task.schedule.split_whitespace().count() == 5 {
        format!("0 {}", task.schedule)
    } else {
        task.schedule.clone()
    };
    let job = Job::new_async(schedule_str.as_str(), move |_uuid, _lock| {
        let script_name = script_name.clone();
        let args = args.clone();
        let log_file = log_file.clone();
        let task_id = task_id.clone();
        let state_ref = state_ref.clone();
        Box::pin(async move {
            if let Some(ref st) = state_ref {
                let mut g = st.lock().await;
                if let Some(s) = g.as_mut() { s.running.insert(task_id.clone(), true); }
            }

            append_log(&log_file, &format!("Starting task '{}'", task_id));
            match resolve_script(&script_name) {
                Ok(script_path) => {
                    match tokio::process::Command::new(&script_path)
                        .args(&args)
                        .kill_on_drop(true)
                        .output()
                        .await
                    {
                        Ok(out) => {
                            if out.status.success() {
                                let stdout = String::from_utf8_lossy(&out.stdout);
                                if !stdout.trim().is_empty() {
                                    append_log(&log_file, &format!("stdout: {}", stdout.trim()));
                                }
                                append_log(&log_file, &format!("Task '{}' completed OK", task_id));
                            } else {
                                let stderr = String::from_utf8_lossy(&out.stderr);
                                append_log(&log_file, &format!("Task '{}' failed (exit {:?}): {}", task_id, out.status.code(), stderr.trim()));
                            }
                        }
                        Err(e) => append_log(&log_file, &format!("Task '{}' exec error: {}", task_id, e)),
                    }
                }
                Err(e) => append_log(&log_file, &format!("Task '{}' script not found: {}", task_id, e)),
            }

            let ts = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
            if let Some(ref st) = state_ref {
                let mut g = st.lock().await;
                if let Some(s) = g.as_mut() {
                    s.running.insert(task_id.clone(), false);
                    s.last_run.insert(task_id, ts);
                }
            }
        })
    })
    .map_err(|e| format!("Failed to build job '{}': {}", task.id, e))?;

    let uuid = job.guid();
    sched.add(job).await.map_err(|e| format!("Failed to add job '{}': {}", task.id, e))?;
    Ok(uuid)
}

// ── Tauri Commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_scheduler_status(
    state: tauri::State<'_, SharedSchedulerState>,
) -> Result<Vec<TaskStatus>, String> {
    with_scheduler(&state, |s| {
        Ok(s.registry
            .tasks
            .iter()
            .map(|t| TaskStatus {
                id: t.id.clone(),
                name: t.name.clone(),
                schedule: t.schedule.clone(),
                enabled: t.enabled,
                created_by_user: t.created_by_user,
                last_run: s.last_run.get(&t.id).cloned(),
                next_run: None,
                running: s.running.get(&t.id).copied().unwrap_or(false),
            })
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn toggle_task(
    app: AppHandle,
    id: String,
    enabled: bool,
    state: tauri::State<'_, SharedSchedulerState>,
) -> Result<(), String> {
    let data_dir_path = data_dir(&app)?;

    let (task_clone, old_uuid, sched) = {
        let mut guard = state.lock().await;
        let s = guard.as_mut().ok_or("Scheduler not initialized")?;
        let idx = s.registry.tasks.iter().position(|t| t.id == id)
            .ok_or_else(|| format!("Task '{}' not found", id))?;
        s.registry.tasks[idx].enabled = enabled;
        let task = s.registry.tasks[idx].clone();
        let uuid = if !enabled { s.job_map.remove(&id) } else { None };
        write_registry(&s.registry_path, &s.registry)?;
        (task, uuid, s.scheduler.clone())
    };

    if let Some(uuid) = old_uuid {
        sched.remove(&uuid).await.ok();
    }

    if enabled {
        let uuid = add_job_to_scheduler(&sched, &task_clone, &data_dir_path, Some(&state.inner().clone())).await
            .map_err(|e| format!("Failed to enable task '{}': {}", id, e))?;
        let mut guard = state.lock().await;
        if let Some(s) = guard.as_mut() {
            s.job_map.insert(id, uuid);
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn run_task_now(
    app: AppHandle,
    id: String,
    state: tauri::State<'_, SharedSchedulerState>,
) -> Result<String, String> {
    let (script_name, args, log_file_path) = {
        let guard = state.lock().await;
        let s = guard.as_ref().ok_or("Scheduler not initialized")?;
        let task = s.registry.tasks.iter().find(|t| t.id == id)
            .ok_or_else(|| format!("Task '{}' not found", id))?;
        let d = data_dir(&app)?;
        (task.command.script.clone(), task.command.args.clone(), log_path(&d, &task.id))
    };

    let script_path = resolve_script(&script_name)?;
    append_log(&log_file_path, &format!("Manual run of task '{}'", id));

    let out = tokio::process::Command::new(&script_path)
        .args(&args)
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| format!("Failed to spawn task '{}': {}", id, e))?;

    let ts = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    {
        let mut guard = state.lock().await;
        if let Some(s) = guard.as_mut() {
            s.last_run.insert(id.clone(), ts);
        }
    }

    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();

    if out.status.success() {
        append_log(&log_file_path, &format!("Manual run of '{}' succeeded", id));
        Ok(format!("{}{}", stdout, stderr))
    } else {
        append_log(&log_file_path, &format!("Manual run of '{}' failed: {}{}", id, stdout, stderr));
        Err(format!("Task '{}' exited with {:?}: {}{}", id, out.status.code(), stdout, stderr))
    }
}

#[tauri::command]
pub async fn get_task_log(
    app: AppHandle,
    id: String,
    lines: Option<u32>,
    state: tauri::State<'_, SharedSchedulerState>,
) -> Result<String, String> {
    let n = lines.unwrap_or(50) as usize;
    let d = data_dir(&app)?;
    let log_file = {
        let guard = state.lock().await;
        let s = guard.as_ref().ok_or("Scheduler not initialized")?;
        let task = s.registry.tasks.iter().find(|t| t.id == id)
            .ok_or_else(|| format!("Task '{}' not found", id))?;
        log_path(&d, &task.id)
    };

    if !log_file.exists() {
        return Ok(String::new());
    }

    let content = tokio::fs::read_to_string(&log_file).await
        .map_err(|e| format!("Failed to read log: {}", e))?;

    let tail: Vec<&str> = content.lines().rev().take(n).collect();
    let result: Vec<&str> = tail.into_iter().rev().collect();
    Ok(result.join("\n"))
}

#[tauri::command]
pub async fn create_task(
    entry: TaskEntry,
    state: tauri::State<'_, SharedSchedulerState>,
    app: AppHandle,
) -> Result<(), String> {
    let d = data_dir(&app)?;
    let task = TaskEntry {
        created_by_user: true,
        ..entry
    };

    if task.id.is_empty() {
        return Err("Task ID cannot be empty".to_string());
    }

    let (enabled, sched) = {
        let guard = state.lock().await;
        let s = guard.as_ref().ok_or("Scheduler not initialized")?;
        if s.registry.tasks.iter().any(|t| t.id == task.id) {
            return Err(format!("Task '{}' already exists", task.id));
        }
        (task.enabled, s.scheduler.clone())
    };

    let maybe_uuid = if enabled {
        Some(add_job_to_scheduler(&sched, &task, &d, Some(&state.inner().clone())).await
            .map_err(|e| format!("Failed to schedule new task: {}", e))?)
    } else {
        None
    };

    let mut guard = state.lock().await;
    let s = guard.as_mut().ok_or("Scheduler not initialized")?;
    if s.registry.tasks.iter().any(|t| t.id == task.id) {
        return Err(format!("Task '{}' already exists (concurrent create)", task.id));
    }
    if let Some(uuid) = maybe_uuid {
        s.job_map.insert(task.id.clone(), uuid);
    }
    s.registry.tasks.push(task);
    write_registry(&s.registry_path, &s.registry)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_task(
    id: String,
    state: tauri::State<'_, SharedSchedulerState>,
) -> Result<(), String> {
    let (old_uuid, sched) = {
        let mut guard = state.lock().await;
        let s = guard.as_mut().ok_or("Scheduler not initialized")?;
        let idx = s.registry.tasks.iter().position(|t| t.id == id)
            .ok_or_else(|| format!("Task '{}' not found", id))?;
        let uuid = s.job_map.remove(&id);
        let sched = s.scheduler.clone();
        s.registry.tasks.remove(idx);
        write_registry(&s.registry_path, &s.registry)?;
        (uuid, sched)
    };

    if let Some(uuid) = old_uuid {
        sched.remove(&uuid).await.ok();
    }

    Ok(())
}

#[tauri::command]
pub async fn update_task(
    id: String,
    entry: TaskEntry,
    state: tauri::State<'_, SharedSchedulerState>,
    app: AppHandle,
) -> Result<(), String> {
    let d = data_dir(&app)?;

    let (old_uuid, sched, was_user_created) = {
        let guard = state.lock().await;
        let s = guard.as_ref().ok_or("Scheduler not initialized")?;
        let idx = s.registry.tasks.iter().position(|t| t.id == id)
            .ok_or_else(|| format!("Task '{}' not found", id))?;
        let uuid = s.job_map.get(&id).copied();
        let was_user = s.registry.tasks[idx].created_by_user;
        (uuid, s.scheduler.clone(), was_user)
    };

    if let Some(uuid) = old_uuid {
        sched.remove(&uuid).await.ok();
    }

    let updated = TaskEntry { created_by_user: was_user_created, ..entry };

    let maybe_uuid = if updated.enabled {
        Some(add_job_to_scheduler(&sched, &updated, &d, Some(&state.inner().clone())).await
            .map_err(|e| format!("Failed to reschedule task: {}", e))?)
    } else {
        None
    };

    let mut guard = state.lock().await;
    let s = guard.as_mut().ok_or("Scheduler not initialized")?;
    let idx = s.registry.tasks.iter().position(|t| t.id == id)
        .ok_or_else(|| format!("Task '{}' vanished during update", id))?;
    s.job_map.remove(&id);
    if let Some(uuid) = maybe_uuid {
        s.job_map.insert(updated.id.clone(), uuid);
    }
    s.registry.tasks[idx] = updated;
    write_registry(&s.registry_path, &s.registry)?;
    Ok(())
}

/// Interface to Winter's SQLite memory database (winter-db.py).
/// Provides context recovery for session continuity by running the Python script
/// and returning its compact output to the frontend.

use tauri::Manager;

/// Fallback path to the winter-db.py script relative to $HOME.
/// Used in dev mode where the Tauri resource dir is not bundled.
const WINTER_DB_DEV_RELATIVE: &str = ".winter/workspace/projects/scripts/winter-db.py";

/// Manages access to the winter-db.py Python script for memory operations.
/// Calls the script as a subprocess to avoid embedding Python logic in Rust.
pub struct WinterMemoryDB {
    /// Absolute path to the winter-db.py script.
    script_path: String,
}

impl WinterMemoryDB {
    /// Creates a new WinterMemoryDB using the bundled resource path from the AppHandle.
    /// Falls back to the dev-server home-relative path if the resource dir is unavailable.
    pub fn new_with_app(app: &tauri::AppHandle) -> Self {
        let script_path = app
            .path()
            .resource_dir()
            .ok()
            .map(|dir| dir.join("resources").join("winter-db.py"))
            .filter(|p| p.exists())
            .and_then(|p| p.to_str().map(|s| s.to_string()))
            .unwrap_or_else(|| {
                std::env::var("HOME")
                    .map(|home| format!("{}/{}", home, WINTER_DB_DEV_RELATIVE))
                    .unwrap_or_else(|_| WINTER_DB_DEV_RELATIVE.to_string())
            });
        Self { script_path }
    }

    /// Runs `python3 <script_path> recover` and returns the compact output.
    /// This output contains active tasks, recent snapshots, and agent execution history.
    pub async fn recover(&self) -> Result<String, String> {
        if !std::path::Path::new(&self.script_path).exists() {
            return Err(format!("winter-db.py not found at {}", self.script_path));
        }
        let output = tokio::process::Command::new("python3")
            .arg(&self.script_path)
            .arg("recover")
            .kill_on_drop(true)
            .output()
            .await
            .map_err(|e| format!("Failed to run winter-db.py: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("winter-db.py recover failed: {}", stderr));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}

/// Interface to Winter's SQLite memory database (winter-db.py).
/// Provides context recovery for session continuity by running the Python script
/// and returning its compact output to the frontend.

/// Default path to the winter-db.py script relative to the user's home directory.
const WINTER_DB_RELATIVE: &str = ".winter/workspace/projects/scripts/winter-db.py";

/// Manages access to the winter-db.py Python script for memory operations.
/// Calls the script as a subprocess to avoid embedding Python logic in Rust.
pub struct WinterMemoryDB {
    /// Absolute path to the winter-db.py script.
    script_path: String,
}

impl WinterMemoryDB {
    /// Creates a new WinterMemoryDB, resolving the script path from $HOME.
    /// Falls back to the default relative path if $HOME is unavailable.
    pub fn new() -> Self {
        let script_path = std::env::var("HOME")
            .map(|home| format!("{}/{}", home, WINTER_DB_RELATIVE))
            .unwrap_or_else(|_| WINTER_DB_RELATIVE.to_string());
        Self { script_path }
    }

    /// Runs `python3 <script_path> recover` and returns the compact output.
    /// This output contains active tasks, recent snapshots, and agent execution history.
    pub async fn recover(&self) -> Result<String, String> {
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

impl Default for WinterMemoryDB {
    fn default() -> Self {
        Self::new()
    }
}

use serde::{Deserialize, Serialize};

const INFRA_CTL: &str = "/home/gyugo/bin/infra-ctl.sh";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceStatus {
    pub id: String,
    pub name: String,
    pub active: bool,
    pub enabled: bool,
    pub category: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CronStatus {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub schedule: String,
    #[serde(rename = "lastLog")]
    pub last_log: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InfraStatus {
    pub services: Vec<ServiceStatus>,
    pub crons: Vec<CronStatus>,
}

#[tauri::command]
pub async fn get_infra_status() -> Result<InfraStatus, String> {
    let output = tokio::process::Command::new(INFRA_CTL)
        .arg("status")
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| format!("Failed to run infra-ctl.sh: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("infra-ctl.sh status failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str::<InfraStatus>(&stdout)
        .map_err(|e| format!("Failed to parse infra status JSON: {}", e))
}

#[tauri::command]
pub async fn toggle_service(service_id: String, action: String) -> Result<(), String> {
    let valid_actions = ["start", "stop", "restart"];
    if !valid_actions.contains(&action.as_str()) {
        return Err(format!("Invalid action '{}'. Must be start, stop, or restart", action));
    }

    let output = tokio::process::Command::new(INFRA_CTL)
        .arg("service")
        .arg(&service_id)
        .arg(&action)
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| format!("Failed to run infra-ctl.sh: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "infra-ctl.sh service {} {} failed: {}{}",
            service_id, action, stdout, stderr
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn toggle_cron(cron_id: String, enabled: bool) -> Result<(), String> {
    let action = if enabled { "enable" } else { "disable" };

    let output = tokio::process::Command::new(INFRA_CTL)
        .arg("cron")
        .arg(&cron_id)
        .arg(action)
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| format!("Failed to run infra-ctl.sh: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "infra-ctl.sh cron {} {} failed: {}{}",
            cron_id, action, stdout, stderr
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn run_cron_now(cron_id: String) -> Result<String, String> {
    let output = tokio::process::Command::new(INFRA_CTL)
        .arg("run")
        .arg(&cron_id)
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| format!("Failed to run infra-ctl.sh: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!(
            "infra-ctl.sh run {} failed: {}{}",
            cron_id, stdout, stderr
        ));
    }

    let mut result = stdout;
    if !stderr.is_empty() {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str(&stderr);
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_cron_log(cron_id: String, lines: Option<u32>) -> Result<String, String> {
    let n = lines.unwrap_or(20);

    let output = tokio::process::Command::new(INFRA_CTL)
        .arg("log")
        .arg(&cron_id)
        .arg(n.to_string())
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| format!("Failed to run infra-ctl.sh: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "infra-ctl.sh log {} failed: {}",
            cron_id, stderr
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

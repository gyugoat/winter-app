/// Cross-platform service manager.
/// Registry stored alongside scheduler-registry.json in Tauri app data dir.
/// Platform dispatch: Linux→systemctl --user, macOS→launchctl, Windows→sc.exe, mobile→noop.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// ── Types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlatformServiceConfig {
    #[serde(rename = "type")]
    pub svc_type: String,
    pub unit: Option<String>,    // systemd
    pub label: Option<String>,   // launchd
    pub name: Option<String>,    // windows service name
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServicePlatformMap {
    pub linux: Option<PlatformServiceConfig>,
    pub macos: Option<PlatformServiceConfig>,
    pub windows: Option<PlatformServiceConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceEntry {
    pub id: String,
    pub name: String,
    pub category: String,
    pub platform: ServicePlatformMap,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceRegistry {
    pub services: Vec<ServiceEntry>,
}

impl Default for ServiceRegistry {
    fn default() -> Self {
        ServiceRegistry {
            services: default_services(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ServiceStatus {
    Running,
    Stopped,
    Unknown,
    NotInstalled,
    Unsupported,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceStatusInfo {
    pub id: String,
    pub name: String,
    pub category: String,
    pub status: ServiceStatus,
    pub supported: bool,
}

// ── Default services (6 from TaskInfo.md) ────────────────────────────

fn default_services() -> Vec<ServiceEntry> {
    vec![
        ServiceEntry {
            id: "winter-opencode".into(),
            name: "Winter Agent".into(),
            category: "agent".into(),
            platform: ServicePlatformMap {
                linux: Some(PlatformServiceConfig {
                    svc_type: "systemd".into(),
                    unit: Some("winter-opencode.service".into()),
                    label: None,
                    name: None,
                }),
                macos: Some(PlatformServiceConfig {
                    svc_type: "launchd".into(),
                    unit: None,
                    label: Some("com.winter.opencode".into()),
                    name: None,
                }),
                windows: Some(PlatformServiceConfig {
                    svc_type: "windows-service".into(),
                    unit: None,
                    label: None,
                    name: Some("WinterOpenCode".into()),
                }),
            },
        },
        ServiceEntry {
            id: "winter-proxy".into(),
            name: "Winter Proxy".into(),
            category: "proxy".into(),
            platform: ServicePlatformMap {
                linux: Some(PlatformServiceConfig {
                    svc_type: "systemd".into(),
                    unit: Some("winter-proxy.service".into()),
                    label: None,
                    name: None,
                }),
                macos: Some(PlatformServiceConfig {
                    svc_type: "launchd".into(),
                    unit: None,
                    label: Some("com.winter.proxy".into()),
                    name: None,
                }),
                windows: Some(PlatformServiceConfig {
                    svc_type: "windows-service".into(),
                    unit: None,
                    label: None,
                    name: Some("WinterProxy".into()),
                }),
            },
        },
        ServiceEntry {
            id: "frost-opencode".into(),
            name: "Frost Agent".into(),
            category: "agent".into(),
            platform: ServicePlatformMap {
                linux: Some(PlatformServiceConfig {
                    svc_type: "systemd".into(),
                    unit: Some("frost-opencode.service".into()),
                    label: None,
                    name: None,
                }),
                macos: Some(PlatformServiceConfig {
                    svc_type: "launchd".into(),
                    unit: None,
                    label: Some("com.frost.opencode".into()),
                    name: None,
                }),
                windows: Some(PlatformServiceConfig {
                    svc_type: "windows-service".into(),
                    unit: None,
                    label: None,
                    name: Some("FrostOpenCode".into()),
                }),
            },
        },
        ServiceEntry {
            id: "frost-proxy".into(),
            name: "Frost Proxy".into(),
            category: "proxy".into(),
            platform: ServicePlatformMap {
                linux: Some(PlatformServiceConfig {
                    svc_type: "systemd".into(),
                    unit: Some("frost-proxy.service".into()),
                    label: None,
                    name: None,
                }),
                macos: Some(PlatformServiceConfig {
                    svc_type: "launchd".into(),
                    unit: None,
                    label: Some("com.frost.proxy".into()),
                    name: None,
                }),
                windows: Some(PlatformServiceConfig {
                    svc_type: "windows-service".into(),
                    unit: None,
                    label: None,
                    name: Some("FrostProxy".into()),
                }),
            },
        },
        ServiceEntry {
            id: "gai-api".into(),
            name: "GAI API".into(),
            category: "ai-service".into(),
            platform: ServicePlatformMap {
                linux: Some(PlatformServiceConfig {
                    svc_type: "systemd".into(),
                    unit: Some("gai-api.service".into()),
                    label: None,
                    name: None,
                }),
                macos: Some(PlatformServiceConfig {
                    svc_type: "launchd".into(),
                    unit: None,
                    label: Some("com.gai.api".into()),
                    name: None,
                }),
                windows: Some(PlatformServiceConfig {
                    svc_type: "windows-service".into(),
                    unit: None,
                    label: None,
                    name: Some("GaiApi".into()),
                }),
            },
        },
        ServiceEntry {
            id: "gpt-sovits".into(),
            name: "TTS Engine".into(),
            category: "ai-service".into(),
            platform: ServicePlatformMap {
                linux: Some(PlatformServiceConfig {
                    svc_type: "systemd".into(),
                    unit: Some("gpt-sovits.service".into()),
                    label: None,
                    name: None,
                }),
                macos: Some(PlatformServiceConfig {
                    svc_type: "launchd".into(),
                    unit: None,
                    label: Some("com.gpt.sovits".into()),
                    name: None,
                }),
                windows: Some(PlatformServiceConfig {
                    svc_type: "windows-service".into(),
                    unit: None,
                    label: None,
                    name: Some("GptSovits".into()),
                }),
            },
        },
    ]
}

// ── ServiceManager trait ──────────────────────────────────────────────

#[async_trait::async_trait]
pub trait ServiceManager: Send + Sync {
    async fn status(&self, svc: &ServiceEntry) -> ServiceStatus;
    async fn start(&self, svc: &ServiceEntry) -> Result<(), String>;
    async fn stop(&self, svc: &ServiceEntry) -> Result<(), String>;
    async fn restart(&self, svc: &ServiceEntry) -> Result<(), String>;
    async fn is_installed(&self, svc: &ServiceEntry) -> bool;
}

// ── Linux: systemctl --user ───────────────────────────────────────────

pub struct LinuxServiceManager;

impl LinuxServiceManager {
    fn unit_name(svc: &ServiceEntry) -> Option<String> {
        svc.platform
            .linux
            .as_ref()
            .and_then(|p| p.unit.clone())
    }

    async fn run_systemctl(args: &[&str]) -> Result<std::process::Output, String> {
        tokio::process::Command::new("systemctl")
            .args(args)
            .kill_on_drop(true)
            .output()
            .await
            .map_err(|e| format!("systemctl error: {}", e))
    }
}

#[async_trait::async_trait]
impl ServiceManager for LinuxServiceManager {
    async fn status(&self, svc: &ServiceEntry) -> ServiceStatus {
        let Some(unit) = Self::unit_name(svc) else {
            return ServiceStatus::Unsupported;
        };
        if !self.is_installed(svc).await {
            return ServiceStatus::NotInstalled;
        }
        match Self::run_systemctl(&["--user", "is-active", "--quiet", &unit]).await {
            Ok(out) if out.status.success() => ServiceStatus::Running,
            Ok(_) => ServiceStatus::Stopped,
            Err(_) => ServiceStatus::Unknown,
        }
    }

    async fn start(&self, svc: &ServiceEntry) -> Result<(), String> {
        let unit = Self::unit_name(svc)
            .ok_or_else(|| format!("No Linux unit configured for '{}'", svc.id))?;
        let out = Self::run_systemctl(&["--user", "start", &unit]).await?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!(
                "systemctl start {} failed: {}",
                unit,
                String::from_utf8_lossy(&out.stderr)
            ))
        }
    }

    async fn stop(&self, svc: &ServiceEntry) -> Result<(), String> {
        let unit = Self::unit_name(svc)
            .ok_or_else(|| format!("No Linux unit configured for '{}'", svc.id))?;
        let out = Self::run_systemctl(&["--user", "stop", &unit]).await?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!(
                "systemctl stop {} failed: {}",
                unit,
                String::from_utf8_lossy(&out.stderr)
            ))
        }
    }

    async fn restart(&self, svc: &ServiceEntry) -> Result<(), String> {
        let unit = Self::unit_name(svc)
            .ok_or_else(|| format!("No Linux unit configured for '{}'", svc.id))?;
        let out = Self::run_systemctl(&["--user", "restart", &unit]).await?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!(
                "systemctl restart {} failed: {}",
                unit,
                String::from_utf8_lossy(&out.stderr)
            ))
        }
    }

    async fn is_installed(&self, svc: &ServiceEntry) -> bool {
        let Some(unit) = Self::unit_name(svc) else {
            return false;
        };
        matches!(
            Self::run_systemctl(&["--user", "list-unit-files", &unit]).await,
            Ok(out) if out.status.success()
                && String::from_utf8_lossy(&out.stdout).contains(&unit)
        )
    }
}

// ── macOS: launchctl ──────────────────────────────────────────────────

pub struct MacOSServiceManager;

impl MacOSServiceManager {
    fn label(svc: &ServiceEntry) -> Option<String> {
        svc.platform
            .macos
            .as_ref()
            .and_then(|p| p.label.clone())
    }
}

#[async_trait::async_trait]
impl ServiceManager for MacOSServiceManager {
    async fn status(&self, svc: &ServiceEntry) -> ServiceStatus {
        let Some(label) = Self::label(svc) else {
            return ServiceStatus::Unsupported;
        };
        let result = tokio::process::Command::new("launchctl")
            .args(["list", &label])
            .kill_on_drop(true)
            .output()
            .await;
        match result {
            Ok(out) => {
                if !out.status.success() {
                    return ServiceStatus::NotInstalled;
                }
                let stdout = String::from_utf8_lossy(&out.stdout);
                if stdout.contains("\"PID\"") {
                    ServiceStatus::Running
                } else {
                    ServiceStatus::Stopped
                }
            }
            Err(_) => ServiceStatus::Unknown,
        }
    }

    async fn start(&self, svc: &ServiceEntry) -> Result<(), String> {
        let label = Self::label(svc)
            .ok_or_else(|| format!("No macOS label configured for '{}'", svc.id))?;
        let out = tokio::process::Command::new("launchctl")
            .args(["start", &label])
            .kill_on_drop(true)
            .output()
            .await
            .map_err(|e| format!("launchctl error: {}", e))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!(
                "launchctl start {} failed: {}",
                label,
                String::from_utf8_lossy(&out.stderr)
            ))
        }
    }

    async fn stop(&self, svc: &ServiceEntry) -> Result<(), String> {
        let label = Self::label(svc)
            .ok_or_else(|| format!("No macOS label configured for '{}'", svc.id))?;
        let out = tokio::process::Command::new("launchctl")
            .args(["stop", &label])
            .kill_on_drop(true)
            .output()
            .await
            .map_err(|e| format!("launchctl error: {}", e))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!(
                "launchctl stop {} failed: {}",
                label,
                String::from_utf8_lossy(&out.stderr)
            ))
        }
    }

    async fn restart(&self, svc: &ServiceEntry) -> Result<(), String> {
        self.stop(svc).await?;
        self.start(svc).await
    }

    async fn is_installed(&self, svc: &ServiceEntry) -> bool {
        let Some(label) = Self::label(svc) else {
            return false;
        };
        matches!(
            tokio::process::Command::new("launchctl")
                .args(["list", &label])
                .kill_on_drop(true)
                .output()
                .await,
            Ok(out) if out.status.success()
        )
    }
}

// ── Windows: sc.exe ───────────────────────────────────────────────────

pub struct WindowsServiceManager;

impl WindowsServiceManager {
    fn svc_name(svc: &ServiceEntry) -> Option<String> {
        svc.platform
            .windows
            .as_ref()
            .and_then(|p| p.name.clone())
    }
}

#[async_trait::async_trait]
impl ServiceManager for WindowsServiceManager {
    async fn status(&self, svc: &ServiceEntry) -> ServiceStatus {
        let Some(name) = Self::svc_name(svc) else {
            return ServiceStatus::Unsupported;
        };
        let result = tokio::process::Command::new("sc.exe")
            .args(["query", &name])
            .kill_on_drop(true)
            .output()
            .await;
        match result {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                if !out.status.success() {
                    return if stdout.contains("1060") {
                        ServiceStatus::NotInstalled
                    } else {
                        ServiceStatus::Unknown
                    };
                }
                if stdout.contains("RUNNING") {
                    ServiceStatus::Running
                } else if stdout.contains("STOPPED") {
                    ServiceStatus::Stopped
                } else {
                    ServiceStatus::Unknown
                }
            }
            Err(_) => ServiceStatus::Unknown,
        }
    }

    async fn start(&self, svc: &ServiceEntry) -> Result<(), String> {
        let name = Self::svc_name(svc)
            .ok_or_else(|| format!("No Windows service name for '{}'", svc.id))?;
        let out = tokio::process::Command::new("sc.exe")
            .args(["start", &name])
            .kill_on_drop(true)
            .output()
            .await
            .map_err(|e| format!("sc.exe error: {}", e))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!(
                "sc start {} failed: {}",
                name,
                String::from_utf8_lossy(&out.stderr)
            ))
        }
    }

    async fn stop(&self, svc: &ServiceEntry) -> Result<(), String> {
        let name = Self::svc_name(svc)
            .ok_or_else(|| format!("No Windows service name for '{}'", svc.id))?;
        let out = tokio::process::Command::new("sc.exe")
            .args(["stop", &name])
            .kill_on_drop(true)
            .output()
            .await
            .map_err(|e| format!("sc.exe error: {}", e))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!(
                "sc stop {} failed: {}",
                name,
                String::from_utf8_lossy(&out.stderr)
            ))
        }
    }

    async fn restart(&self, svc: &ServiceEntry) -> Result<(), String> {
        self.stop(svc).await.ok(); // ignore stop failure (may already be stopped)
        self.start(svc).await
    }

    async fn is_installed(&self, svc: &ServiceEntry) -> bool {
        matches!(self.status(svc).await, ServiceStatus::Running | ServiceStatus::Stopped)
    }
}

// ── Noop: iOS/Android ─────────────────────────────────────────────────

pub struct NoopServiceManager;

#[async_trait::async_trait]
impl ServiceManager for NoopServiceManager {
    async fn status(&self, _svc: &ServiceEntry) -> ServiceStatus {
        ServiceStatus::Unsupported
    }
    async fn start(&self, svc: &ServiceEntry) -> Result<(), String> {
        Err(format!("Service management not supported on this platform ({})", svc.id))
    }
    async fn stop(&self, svc: &ServiceEntry) -> Result<(), String> {
        Err(format!("Service management not supported on this platform ({})", svc.id))
    }
    async fn restart(&self, svc: &ServiceEntry) -> Result<(), String> {
        Err(format!("Service management not supported on this platform ({})", svc.id))
    }
    async fn is_installed(&self, _svc: &ServiceEntry) -> bool {
        false
    }
}

// ── Factory ───────────────────────────────────────────────────────────

pub fn create_service_manager() -> Box<dyn ServiceManager> {
    #[cfg(target_os = "linux")]
    {
        Box::new(LinuxServiceManager)
    }
    #[cfg(target_os = "macos")]
    {
        Box::new(MacOSServiceManager)
    }
    #[cfg(target_os = "windows")]
    {
        Box::new(WindowsServiceManager)
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        Box::new(NoopServiceManager)
    }
}

// ── Registry I/O ─────────────────────────────────────────────────────

fn registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {}", e))?;
    Ok(data_dir.join("scheduler-registry.json"))
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct CombinedRegistry {
    #[serde(default)]
    tasks: Vec<serde_json::Value>,
    #[serde(default)]
    services: Vec<ServiceEntry>,
}

fn read_service_registry(app: &AppHandle) -> Result<Vec<ServiceEntry>, String> {
    let path = registry_path(app)?;
    if !path.exists() {
        return Ok(default_services());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read registry: {}", e))?;
    let combined: CombinedRegistry = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse registry: {}", e))?;
    if combined.services.is_empty() {
        Ok(default_services())
    } else {
        Ok(combined.services)
    }
}

#[allow(dead_code)]
fn write_services_to_registry(app: &AppHandle, services: &[ServiceEntry]) -> Result<(), String> {
    let path = registry_path(app)?;
    let mut combined: CombinedRegistry = if path.exists() {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read registry: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        CombinedRegistry::default()
    };
    combined.services = services.to_vec();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create registry dir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(&combined)
        .map_err(|e| format!("Failed to serialize registry: {}", e))?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write registry: {}", e))
}

// ── Tauri Commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_services_status(app: AppHandle) -> Result<Vec<ServiceStatusInfo>, String> {
    let services = read_service_registry(&app)?;
    let manager = create_service_manager();

    let mut result = Vec::new();
    for svc in &services {
        let status = manager.status(svc).await;
        let supported = status != ServiceStatus::Unsupported;
        result.push(ServiceStatusInfo {
            id: svc.id.clone(),
            name: svc.name.clone(),
            category: svc.category.clone(),
            status,
            supported,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn control_service(
    app: AppHandle,
    id: String,
    action: String,
) -> Result<(), String> {
    let valid_actions = ["start", "stop", "restart"];
    if !valid_actions.contains(&action.as_str()) {
        return Err(format!(
            "Invalid action '{}'. Must be start, stop, or restart",
            action
        ));
    }

    let services = read_service_registry(&app)?;
    let svc = services
        .iter()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("Service '{}' not found", id))?;

    let manager = create_service_manager();
    match action.as_str() {
        "start" => manager.start(svc).await,
        "stop" => manager.stop(svc).await,
        "restart" => manager.restart(svc).await,
        _ => unreachable!(),
    }
}

mod rules;
mod scanner;
mod tree;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use rules::Recommendation;
use scanner::{Node, Progress};
use tree::{TreeItem, View};

struct ScanData {
    home: PathBuf,
    root: Node,
    recs: Vec<Recommendation>,
}

#[derive(Default)]
struct AppState {
    data: Mutex<Option<ScanData>>,
    progress: Arc<Progress>,
    scanning: AtomicBool,
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set".into())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanProgress {
    files: u64,
    bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanSummary {
    home: String,
    size: u64,
    files: u64,
    millis: u64,
    cancelled: bool,
}

#[tauri::command]
async fn start_scan(app: AppHandle, state: State<'_, AppState>) -> Result<ScanSummary, String> {
    let home = home_dir()?;
    if state.scanning.swap(true, Ordering::SeqCst) {
        return Err("A scan is already running".into());
    }
    let progress = state.progress.clone();
    progress.reset();

    let done = Arc::new(AtomicBool::new(false));
    let ticker = {
        let (progress, done, app) = (progress.clone(), done.clone(), app.clone());
        std::thread::spawn(move || {
            while !done.load(Ordering::Relaxed) {
                let _ = app.emit(
                    "scan-progress",
                    ScanProgress {
                        files: progress.files.load(Ordering::Relaxed),
                        bytes: progress.bytes.load(Ordering::Relaxed),
                    },
                );
                std::thread::sleep(Duration::from_millis(120));
            }
        })
    };

    let started = Instant::now();
    let scan_home = home.clone();
    let scan_progress = progress.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let root = scanner::scan(&scan_home, &scan_progress);
        let recs = rules::evaluate(&scan_home, &root);
        (root, recs)
    })
    .await;
    done.store(true, Ordering::Relaxed);
    let _ = ticker.join();
    state.scanning.store(false, Ordering::SeqCst);

    let (root, recs) = result.map_err(|e| e.to_string())?;
    let cancelled = progress.cancel.load(Ordering::Relaxed);
    let summary = ScanSummary {
        home: home.to_string_lossy().into_owned(),
        size: root.size,
        files: root.file_count,
        millis: started.elapsed().as_millis() as u64,
        cancelled,
    };
    if !cancelled {
        *state.data.lock().unwrap() = Some(ScanData { home, root, recs });
    }
    Ok(summary)
}

#[tauri::command]
fn cancel_scan(state: State<'_, AppState>) {
    state.progress.cancel.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn get_tree(path: Option<String>, depth: Option<u8>, state: State<'_, AppState>) -> Result<TreeItem, String> {
    let guard = state.data.lock().unwrap();
    let data = guard.as_ref().ok_or("No scan results yet")?;
    let home = data.home.to_string_lossy();
    let view = View::new(&home, &data.recs);
    let target = path.unwrap_or_else(|| home.to_string());
    view.build(&data.root, &target, depth.unwrap_or(2))
        .ok_or_else(|| format!("{target} is not in the scanned tree"))
}

#[tauri::command]
fn get_recommendations(state: State<'_, AppState>) -> Result<Vec<Recommendation>, String> {
    let guard = state.data.lock().unwrap();
    let data = guard.as_ref().ok_or("No scan results yet")?;
    Ok(data.recs.clone())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiskInfo {
    total: u64,
    free: u64,
}

#[cfg(unix)]
#[tauri::command]
fn disk_info() -> Result<DiskInfo, String> {
    let home = home_dir()?;
    let c_path = std::ffi::CString::new(home.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    let mut stat: libc::statfs = unsafe { std::mem::zeroed() };
    // SAFETY: c_path is a valid NUL-terminated string and stat is a valid out pointer.
    if unsafe { libc::statfs(c_path.as_ptr(), &mut stat) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let bsize = stat.f_bsize as u64;
    Ok(DiskInfo {
        total: stat.f_blocks * bsize,
        free: stat.f_bavail * bsize,
    })
}

#[cfg(windows)]
#[tauri::command]
fn disk_info() -> Result<DiskInfo, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let home = home_dir()?;
    let wide: Vec<u16> = home.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let (mut free, mut total) = (0u64, 0u64);
    // SAFETY: wide is NUL-terminated and the out pointers are valid for writes.
    if unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, &mut total, std::ptr::null_mut()) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(DiskInfo { total, free })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrashResult {
    trashed: Vec<String>,
    failed: Vec<(String, String)>,
    bytes: u64,
}

/// Moves recommended paths to the Trash. Only paths produced by the cleanup
/// rules are accepted, so the frontend cannot trash arbitrary locations.
#[tauri::command]
async fn trash_paths(paths: Vec<String>, state: State<'_, AppState>) -> Result<TrashResult, String> {
    let allowed: Vec<String> = {
        let guard = state.data.lock().unwrap();
        let data = guard.as_ref().ok_or("No scan results yet")?;
        data.recs.iter().flat_map(|r| r.paths.iter().map(|p| p.path.clone())).collect()
    };
    let (ok, mut failed): (Vec<String>, Vec<String>) = paths.into_iter().partition(|p| allowed.contains(p));
    let mut result = TrashResult {
        trashed: Vec::new(),
        failed: failed.drain(..).map(|p| (p, "Not a recommended cleanup path".into())).collect(),
        bytes: 0,
    };

    let outcomes = tauri::async_runtime::spawn_blocking(move || {
        ok.into_iter()
            .map(|p| {
                let r = trash::delete(&p).map_err(|e| e.to_string());
                (p, r)
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| e.to_string())?;

    let mut guard = state.data.lock().unwrap();
    let data = guard.as_mut().ok_or("No scan results yet")?;
    let home = data.home.to_string_lossy().into_owned();
    for (path, outcome) in outcomes {
        match outcome {
            Ok(()) => {
                if let Some(rel) = path.strip_prefix(&home) {
                    let parts: Vec<&str> = rel.split('/').filter(|s| !s.is_empty()).collect();
                    result.bytes += data.root.remove(&parts).unwrap_or(0);
                }
                result.trashed.push(path);
            }
            Err(e) => result.failed.push((path, e)),
        }
    }
    data.recs = rules::evaluate(&data.home, &data.root);
    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            start_scan,
            cancel_scan,
            get_tree,
            get_recommendations,
            disk_info,
            trash_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


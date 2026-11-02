#[cfg(target_os = "macos")]
mod apple;
mod commands;
mod db;
mod update;
mod models;
mod store;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Manager;

use crate::commands::DbState;

/// The database lives in the standard per-user application data folder.
/// `RECIPROCAL_DATA_DIR` can override it (handy for development and for
/// keeping a throw-away profile).
fn resolve_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(custom) = std::env::var("RECIPROCAL_DATA_DIR") {
        let trimmed = custom.trim().to_string();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    Ok(app.path().app_data_dir()?)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = resolve_data_dir(app.handle())?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("reciprocal.db");
            let conn = db::open(&db_path)?;
            if cfg!(debug_assertions) || std::env::var_os("RECIPROCAL_LOG").is_some() {
                eprintln!("[reciprocal] database ready at {}", db_path.display());
            }
            app.manage(DbState {
                conn: Mutex::new(conn),
                path: db_path,
            });

            #[cfg(target_os = "macos")]
            if cfg!(debug_assertions) || std::env::var_os("RECIPROCAL_LOG").is_some() {
                eprintln!(
                    "[reciprocal] apple calendar authorization: {}",
                    apple::authorization_status()
                );
                match apple::list_calendars() {
                    Ok(calendars) => eprintln!(
                        "[reciprocal] apple calendars visible: {}",
                        calendars.len()
                    ),
                    Err(error) => eprintln!("[reciprocal] apple calendar probe failed: {error}"),
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_app,
            commands::save_habit,
            commands::delete_habit,
            commands::set_habit_archived,
            commands::set_habit_log,
            commands::save_event,
            commands::delete_event,
            commands::save_task,
            commands::set_task_status,
            commands::delete_task,
            commands::save_timetable,
            commands::delete_timetable,
            commands::set_setting,
            commands::export_backup,
            commands::import_backup,
            commands::clear_all_data,
            commands::storage_info,
            commands::apple_status,
            commands::apple_connect,
            commands::apple_disconnect,
            commands::apple_sync,
            commands::apple_calendars,
            commands::apple_set_calendars,
            commands::check_for_updates,
            commands::open_external,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

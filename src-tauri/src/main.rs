#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

#[derive(Serialize, Deserialize, Clone)]
struct Todo {
    id: u64,
    text: String,
    done: bool,
    #[serde(default)]
    date: String,
    #[serde(default)]
    is_my_day: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct Note {
    id: u64,
    title: String,
    content: String,
    created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct AppSettings {
    #[serde(default)]
    autostart: bool,
    #[serde(default)]
    start_minimized: bool,
}

fn data_file(app: &tauri::AppHandle) -> PathBuf {
    let mut dir = app
        .path()
        .app_data_dir()
        .expect("failed to resolve app data dir");
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    dir.push("todos.json");
    dir
}

fn notes_file(app: &tauri::AppHandle) -> PathBuf {
    let mut dir = app
        .path()
        .app_data_dir()
        .expect("failed to resolve app data dir");
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    dir.push("notes.json");
    dir
}

fn settings_file(app: &tauri::AppHandle) -> PathBuf {
    let mut dir = app
        .path()
        .app_data_dir()
        .expect("failed to resolve app data dir");
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    dir.push("settings.json");
    dir
}

#[tauri::command]
fn load_todos(app: tauri::AppHandle) -> Vec<Todo> {
    let path = data_file(&app);
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<Todo>>(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn save_todos(app: tauri::AppHandle, todos: Vec<Todo>) -> Result<(), String> {
    let path = data_file(&app);
    let json = serde_json::to_string_pretty(&todos).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_notes(app: tauri::AppHandle) -> Vec<Note> {
    let path = notes_file(&app);
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<Note>>(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn save_notes(app: tauri::AppHandle, notes: Vec<Note>) -> Result<(), String> {
    let path = notes_file(&app);
    let json = serde_json::to_string_pretty(&notes).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> AppSettings {
    let path = settings_file(&app);
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<AppSettings>(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_file(&app);
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            let exe_str = exe_path.to_string_lossy();
            if settings.autostart {
                let _ = std::process::Command::new("reg")
                    .args(&[
                        "add",
                        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                        "/v",
                        "TodoRS",
                        "/t",
                        "REG_SZ",
                        "/d",
                        &format!("\"{}\"", exe_str),
                        "/f",
                    ])
                    .output();
            } else {
                let _ = std::process::Command::new("reg")
                    .args(&[
                        "delete",
                        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                        "/v",
                        "TodoRS",
                        "/f",
                    ])
                    .output();
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Ok(config_dir) = app.path().config_dir() {
                let autostart_dir = config_dir.join("autostart");
                let desktop_file = autostart_dir.join("todo-rs.desktop");
                if settings.autostart {
                    let _ = fs::create_dir_all(&autostart_dir);
                    let content = format!(
                        "[Desktop Entry]\nType=Application\nName=TodoRS\nExec=env GDK_BACKEND=x11 \"{}\"\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
                        exe_path.display()
                    );
                    let _ = fs::write(desktop_file, content);
                } else if desktop_file.exists() {
                    let _ = fs::remove_file(desktop_file);
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn hide_window(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn position_near_tray(window: &tauri::WebviewWindow, tray_rect: Option<tauri::Rect>) {
    let monitor = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.available_monitors().ok().and_then(|ms| ms.into_iter().next()));

    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let win_size = match window.outer_size() {
        Ok(s) if s.width > 0 && s.height > 0 => s,
        _ => tauri::PhysicalSize::new((370.0 * scale_factor) as u32, (530.0 * scale_factor) as u32),
    };

    if let Some(monitor) = monitor {
        let work_area = monitor.work_area();
        let margin = (12.0 * scale_factor) as i32;

        let (rx, ry, rw, rh) = if let Some(rect) = tray_rect {
            let pos = match rect.position {
                tauri::Position::Physical(p) => (p.x, p.y),
                tauri::Position::Logical(l) => ((l.x * scale_factor) as i32, (l.y * scale_factor) as i32),
            };
            let s = match rect.size {
                tauri::Size::Physical(s) => (s.width as i32, s.height as i32),
                tauri::Size::Logical(l) => ((l.width * scale_factor) as i32, (l.height * scale_factor) as i32),
            };
            (pos.0, pos.1, s.0, s.1)
        } else {
            (0, 0, 0, 0)
        };

        let (target_x, target_y) = if rw > 0 && rh > 0 {
            let tx = rx + (rw / 2) - (win_size.width as i32 / 2);
            let ty = if ry < (work_area.position.y + work_area.size.height as i32 / 2) {
                ry + rh + margin
            } else {
                ry - (win_size.height as i32) - margin
            };
            (tx, ty)
        } else {
            let tx = work_area.position.x + (work_area.size.width as i32) - (win_size.width as i32) - margin;
            let ty = work_area.position.y + (work_area.size.height as i32) - (win_size.height as i32) - margin;
            (tx, ty)
        };

        let max_x = work_area.position.x + (work_area.size.width as i32) - (win_size.width as i32) - margin;
        let max_y = work_area.position.y + (work_area.size.height as i32) - (win_size.height as i32) - margin;
        let min_x = work_area.position.x + margin;
        let min_y = work_area.position.y + margin;

        let final_x = target_x.clamp(min_x, max_x);
        let final_y = target_y.clamp(min_y, max_y);

        let _ = window.set_position(tauri::PhysicalPosition::new(final_x, final_y));
    }
}

fn toggle_window(app: &tauri::AppHandle, tray_rect: Option<tauri::Rect>) {
    if let Some(window) = app.get_webview_window("main") {
        match window.is_visible() {
            Ok(true) => {
                let _ = window.hide();
            }
            _ => {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                position_near_tray(&window, tray_rect);

                let window_clone = window.clone();
                tauri::async_runtime::spawn(async move {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    position_near_tray(&window_clone, tray_rect);
                });
            }
        }
    }
}

fn show_window(app: &tauri::AppHandle, tray_rect: Option<tauri::Rect>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        position_near_tray(&window, tray_rect);

        let window_clone = window.clone();
        tauri::async_runtime::spawn(async move {
            std::thread::sleep(std::time::Duration::from_millis(50));
            position_near_tray(&window_clone, tray_rect);
        });
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("GDK_BACKEND").is_none() {
            std::env::set_var("GDK_BACKEND", "x11");
        }
    }
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_todos,
            save_todos,
            load_notes,
            save_notes,
            load_settings,
            save_settings,
            hide_window,
            exit_app
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let show_i = MenuItem::with_id(app, "show", "Mostrar", true, None::<&str>)?;
            let hide_i = MenuItem::with_id(app, "hide", "Ocultar", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &hide_i, &quit_i])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("bundle should include a default icon");

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .tooltip("Todo")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        show_window(app, None);
                    }
                    "hide" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle(), Some(rect));
                    }
                })
                .build(app)?;

            // Check if start_minimized is false, then show window on launch
            let settings = load_settings(app.handle().clone());
            if !settings.start_minimized {
                show_window(app.handle(), None);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

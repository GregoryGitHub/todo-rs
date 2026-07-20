#![windows_subsystem = "windows"]

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
fn hide_window(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn position_near_tray(window: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = window.primary_monitor() {
        if let (Ok(win_size), Ok(scale_factor)) = (window.outer_size(), window.scale_factor()) {
            let work_area = monitor.work_area();
            let margin = (12.0 * scale_factor) as i32;
            let x = work_area.position.x + (work_area.size.width as i32) - (win_size.width as i32) - margin;
            let y = work_area.position.y + (work_area.size.height as i32) - (win_size.height as i32) - margin;
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        }
    }
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        match window.is_visible() {
            Ok(true) => {
                let _ = window.hide();
            }
            _ => {
                position_near_tray(&window);
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
    }
}

fn show_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        position_near_tray(&window);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_todos,
            save_todos,
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
                        show_window(app);
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
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

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

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        match window.is_visible() {
            Ok(true) => {
                let _ = window.hide();
            }
            _ => {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![load_todos, save_todos])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hide window instead of closing so app stays alive in tray
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let hide_i = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
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
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
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

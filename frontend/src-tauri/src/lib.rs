use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const DEFAULT_HOTKEY: &str = "CommandOrControl+Shift+Space";

struct AppState {
    /// "Keep the palette open when I click away".
    pinned: AtomicBool,
    hotkey: String,
    hotkey_registered: AtomicBool,
}

#[derive(Serialize)]
struct AppInfo {
    version: String,
    hotkey: String,
    hotkey_registered: bool,
    pinned: bool,
    platform: String,
}

fn is_pinned(app: &AppHandle) -> bool {
    app.state::<AppState>().pinned.load(Ordering::Relaxed)
}

/// Put the palette near the top third of the display the mouse is on (multi-monitor friendly).
fn place_on_cursor_monitor(app: &AppHandle, w: &WebviewWindow) {
    let placed = (|| -> Option<()> {
        let cursor = app.cursor_position().ok()?;
        let monitor = app.monitor_from_point(cursor.x, cursor.y).ok()??;
        let size = w.outer_size().ok()?;
        let (pos, area) = (monitor.position(), monitor.size());
        let x = pos.x + (area.width as i32 - size.width as i32) / 2;
        let y = pos.y + (area.height as f64 * 0.2) as i32;
        w.set_position(PhysicalPosition::new(x, y)).ok()
    })();
    if placed.is_none() {
        let _ = w.center();
    }
}

fn reveal_palette(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if !is_pinned(app) {
            place_on_cursor_monitor(app, &w); // a pinned palette stays where you put it
        }
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit("palette:shown", ());
    }
}

fn toggle_palette(app: &AppHandle) {
    match app.get_webview_window("main") {
        Some(w) if w.is_visible().unwrap_or(false) => {
            let _ = w.hide();
        }
        Some(_) => reveal_palette(app),
        None => {}
    }
}

/// The Dashboard is a normal window (title bar, minimize, zoom, resize). While it is open the app shows in the Dock.
fn open_dashboard_window(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

    if let Some(w) = app.get_webview_window("dashboard") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, "dashboard", WebviewUrl::App("index.html".into()))
        .title("Mercury Cmd")
        .inner_size(1120.0, 740.0)
        .min_inner_size(980.0, 600.0)
        .resizable(true)
        .center()
        .build();
    if let Err(e) = built {
        eprintln!("could not open the dashboard: {e}");
    }
}

#[tauri::command]
fn get_app_info(app: AppHandle, state: State<AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        hotkey: state.hotkey.clone(),
        hotkey_registered: state.hotkey_registered.load(Ordering::Relaxed),
        pinned: state.pinned.load(Ordering::Relaxed),
        platform: std::env::consts::OS.to_string(),
    }
}

#[tauri::command]
fn set_pinned(state: State<AppState>, pinned: bool) {
    state.pinned.store(pinned, Ordering::Relaxed);
}

#[tauri::command]
fn open_dashboard(app: AppHandle) {
    open_dashboard_window(&app);
}

#[tauri::command]
fn show_palette(app: AppHandle) {
    reveal_palette(&app);
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// "CommandOrControl+Shift+Space" -> "⌘⇧Space" for the menu label.
fn pretty_hotkey(hotkey: &str) -> String {
    hotkey
        .split('+')
        .map(|part| match part {
            "CommandOrControl" | "CmdOrCtrl" | "Command" | "Cmd" | "Super" => "⌘",
            "Control" | "Ctrl" => "⌃",
            "Shift" => "⇧",
            "Alt" | "Option" => "⌥",
            other => other,
        })
        .collect()
}

/// The app has no Dock icon while only the palette is used (accessory policy), so the menu bar is its handle.
fn setup_tray(app: &tauri::App, hotkey: &str) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", format!("Open Mercury Cmd   {}", pretty_hotkey(hotkey)), true, None::<&str>)?;
    let dashboard = MenuItem::with_id(app, "dashboard", "Open Dashboard", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Mercury Cmd", true, Some("Cmd+Q"))?;
    let menu = Menu::with_items(app, &[&open, &dashboard, &PredefinedMenuItem::separator(app)?, &quit])?;

    TrayIconBuilder::with_id("mercury")
        .icon(tauri::include_image!("icons/tray.png"))
        .icon_as_template(true) // monochrome glyph that adapts to light and dark menu bars
        .tooltip("Mercury Cmd")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => reveal_palette(app),
            "dashboard" => open_dashboard_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_palette(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hotkey = std::env::var("MERCURY_HOTKEY").unwrap_or_else(|_| DEFAULT_HOTKEY.into());

    tauri::Builder::default()
        .manage(AppState { pinned: AtomicBool::new(false), hotkey: hotkey.clone(), hotkey_registered: AtomicBool::new(false) })
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // The handler fires on press AND release; toggle on press only.
                    if event.state() == ShortcutState::Pressed {
                        toggle_palette(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![get_app_info, set_pinned, open_dashboard, show_palette, quit_app])
        .on_window_event(|window, event| match (window.label(), event) {
            // Palette: hide on blur (debounced so focus bouncing during show() does not flicker), unless pinned.
            ("main", WindowEvent::Focused(false)) => {
                let w = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(150));
                    if !w.is_focused().unwrap_or(true) && !is_pinned(w.app_handle()) {
                        let _ = w.hide();
                    }
                });
            }
            // Closing the Dashboard returns the app to menu-bar-only mode.
            ("dashboard", WindowEvent::Destroyed) => {
                #[cfg(target_os = "macos")]
                let _ = window.app_handle().set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            _ => {}
        })
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // A taken or invalid hotkey must not stop the app: the menu-bar icon still works, and the UI says why.
            let registered = match hotkey.parse::<Shortcut>() {
                Ok(shortcut) => match app.global_shortcut().register(shortcut) {
                    Ok(()) => true,
                    Err(e) => {
                        eprintln!("could not register the hotkey {hotkey}: {e}");
                        false
                    }
                },
                Err(e) => {
                    eprintln!("invalid MERCURY_HOTKEY '{hotkey}': {e}");
                    false
                }
            };
            app.state::<AppState>().hotkey_registered.store(registered, Ordering::Relaxed);
            setup_tray(app, &hotkey)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Mercury Cmd");
}

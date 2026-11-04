use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const DEFAULT_HOTKEY: &str = "CommandOrControl+Shift+Space";

fn show_palette(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.center();
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
        Some(_) => show_palette(app),
        None => {}
    }
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

/// The app has no Dock icon (accessory policy), so the menu bar is its only visible handle: open and quit live here.
fn setup_tray(app: &tauri::App, hotkey: &str) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", format!("Open Mercury Cmd   {}", pretty_hotkey(hotkey)), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Mercury Cmd", true, Some("Cmd+Q"))?;
    let menu = Menu::with_items(app, &[&open, &PredefinedMenuItem::separator(app)?, &quit])?;

    TrayIconBuilder::with_id("mercury")
        .icon(tauri::include_image!("icons/tray.png"))
        .icon_as_template(true) // monochrome glyph that adapts to light and dark menu bars
        .tooltip("Mercury Cmd")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_palette(app),
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
    tauri::Builder::default()
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
        .on_window_event(|window, event| {
            // Hide on blur, debounced so focus bouncing during show() does not flicker.
            if let WindowEvent::Focused(false) = event {
                let w = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(150));
                    if !w.is_focused().unwrap_or(true) {
                        let _ = w.hide();
                    }
                });
            }
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let hotkey = std::env::var("MERCURY_HOTKEY").unwrap_or_else(|_| DEFAULT_HOTKEY.into());
            let shortcut: Shortcut = hotkey
                .parse()
                .map_err(|e| format!("invalid MERCURY_HOTKEY '{hotkey}': {e}"))?;
            app.global_shortcut().register(shortcut)?;
            setup_tray(app, &hotkey)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Mercury Cmd");
}

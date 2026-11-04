use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const DEFAULT_HOTKEY: &str = "CommandOrControl+Shift+Space";

fn toggle_palette(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.center();
            let _ = w.show();
            let _ = w.set_focus();
            let _ = app.emit("palette:shown", ());
        }
    }
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Mercury Cmd");
}

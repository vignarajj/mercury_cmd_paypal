use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalPosition, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
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

/// A display in logical points, the unit macOS positions windows in. The origin is the top-left of the primary display.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Area {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// Where a palette of size `win` goes: centred across the display that holds `cursor`, a fifth of the way down.
fn palette_origin(cursor: (f64, f64), areas: &[Area], win: (f64, f64)) -> Option<(f64, f64)> {
    let a = areas
        .iter()
        .find(|a| cursor.0 >= a.x && cursor.0 < a.x + a.w && cursor.1 >= a.y && cursor.1 < a.y + a.h)?;
    Some((a.x + (a.w - win.0) / 2.0, a.y + a.h * 0.2))
}

/// Put the palette near the top of the display the mouse is on (multi-monitor friendly).
///
/// Everything here is worked out in logical points. On macOS tao reports the cursor in physical pixels of the
/// primary display but each display's bounds in points, and each display's own position and size in that display's
/// pixels. Mixing them puts the palette on the wrong display, or half off the screen, when the displays have
/// different scale factors (for example a Retina laptop next to an external monitor).
fn place_on_cursor_monitor(app: &AppHandle, w: &WebviewWindow) {
    let placed = (|| -> Option<()> {
        let primary_scale = app.primary_monitor().ok()??.scale_factor();
        let c = app.cursor_position().ok()?;
        let cursor = (c.x / primary_scale, c.y / primary_scale);
        let areas: Vec<Area> = app
            .available_monitors()
            .ok()?
            .iter()
            .map(|m| {
                let (s, p, z) = (m.scale_factor(), m.position(), m.size());
                Area { x: p.x as f64 / s, y: p.y as f64 / s, w: z.width as f64 / s, h: z.height as f64 / s }
            })
            .collect();
        let (size, scale) = (w.outer_size().ok()?, w.scale_factor().ok()?);
        let win = (size.width as f64 / scale, size.height as f64 / scale);
        let (x, y) = palette_origin(cursor, &areas, win)?;
        w.set_position(LogicalPosition::new(x, y)).ok()
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
    {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        // The Dock tile is created when the app becomes a regular app, so the icon has to be set after this point.
        let _ = app.run_on_main_thread(set_dock_icon);
    }

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

/// `tauri dev` runs a bare binary, not an .app bundle, so macOS shows the generic "exec" icon in the Dock.
/// Setting the application icon at runtime makes the dev build look like the packaged app (which uses icon.icns).
#[cfg(target_os = "macos")]
fn set_dock_icon() {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    let Some(mtm) = MainThreadMarker::new() else { return };
    let data = NSData::with_bytes(include_bytes!("../icons/icon.png"));
    if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
        unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&image)) };
    }
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
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                set_dock_icon();
            }

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

#[cfg(test)]
mod tests {
    use super::*;

    const PALETTE: (f64, f64) = (680.0, 270.0);

    // A Retina laptop (1512x982 points) with a 1920x1080 monitor to its right, as laid out on a real desk.
    fn laptop_and_monitor() -> [Area; 2] {
        [Area { x: 0.0, y: 0.0, w: 1512.0, h: 982.0 }, Area { x: 1512.0, y: 155.0, w: 1920.0, h: 1080.0 }]
    }

    #[test]
    fn centres_on_a_single_display() {
        let areas = [Area { x: 0.0, y: 0.0, w: 1512.0, h: 982.0 }];
        let (x, y) = palette_origin((300.0, 200.0), &areas, PALETTE).unwrap();
        assert_eq!(x, 416.0);
        assert!((y - 196.4).abs() < 0.01);
    }

    #[test]
    fn right_half_of_the_laptop_stays_on_the_laptop() {
        // This cursor position used to be read as being on the external monitor, which pushed the palette off the edge.
        let (x, _) = palette_origin((1200.0, 400.0), &laptop_and_monitor(), PALETTE).unwrap();
        assert_eq!(x, 416.0);
        assert!(x + PALETTE.0 <= 1512.0);
    }

    #[test]
    fn centres_on_the_external_monitor() {
        let (x, y) = palette_origin((2600.0, 600.0), &laptop_and_monitor(), PALETTE).unwrap();
        assert_eq!(x, 2132.0);
        assert!((y - (155.0 + 216.0)).abs() < 0.01);
    }

    #[test]
    fn display_above_the_primary_one() {
        let areas = [Area { x: 0.0, y: 0.0, w: 1512.0, h: 982.0 }, Area { x: 0.0, y: -1080.0, w: 1920.0, h: 1080.0 }];
        let (x, y) = palette_origin((900.0, -500.0), &areas, PALETTE).unwrap();
        assert_eq!(x, 620.0);
        assert!((y - (-1080.0 + 216.0)).abs() < 0.01);
    }

    #[test]
    fn cursor_outside_every_display_gives_nothing() {
        assert_eq!(palette_origin((9000.0, 9000.0), &laptop_and_monitor(), PALETTE), None);
        assert_eq!(palette_origin((10.0, 10.0), &[], PALETTE), None);
    }
}

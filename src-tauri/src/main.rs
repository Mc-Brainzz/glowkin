// The overlay shell: a small transparent always-on-top window that hosts the
// web renderer. All drawing and physics live in web/. This file watches the
// cursor, moves the window while the creature is held, lets clicks through
// everywhere else, and reads the genome from disk.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow,
};

/// What the page has told us. All lengths are CSS pixels inside the window.
#[derive(Default, Clone, Copy)]
struct Shared {
    /// Where on the creature the cursor grabbed it, while it is held.
    grab: Option<(f64, f64)>,
    /// The creature's body: centre and radius. Clicks outside it pass through.
    hit: Option<(f64, f64, f64)>,
}
type SharedState = Arc<Mutex<Shared>>;

#[derive(Serialize, Clone)]
struct Tick {
    /// Cursor position relative to the window.
    cx: f64,
    cy: f64,
    /// How far the window has moved since the last tick.
    dx: f64,
    dy: f64,
    /// Whether the cursor is on the creature.
    over: bool,
}

#[derive(Serialize, Deserialize)]
struct Saved {
    x: i32,
    y: i32,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn state_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().home_dir().ok().map(|home| home.join(".glowkin"))
}

#[tauri::command]
fn set_hit(state: State<SharedState>, x: f64, y: f64, r: f64) {
    state.lock().unwrap().hit = Some((x, y, r));
}

#[tauri::command]
fn grab_start(state: State<SharedState>, gx: f64, gy: f64) {
    state.lock().unwrap().grab = Some((gx, gy));
}

/// Let go, and remember where the creature was left for the next launch.
#[tauri::command]
fn grab_end(app: AppHandle, window: WebviewWindow, state: State<SharedState>) -> Result<(), String> {
    state.lock().unwrap().grab = None;
    let pos = window.outer_position().map_err(err)?;
    let dir = state_dir(&app).ok_or("no home directory")?;
    fs::create_dir_all(&dir).map_err(err)?;
    let json = serde_json::to_string(&Saved { x: pos.x, y: pos.y }).map_err(err)?;
    fs::write(dir.join("overlay.json"), json).map_err(err)
}

/// The genome written by `npm run hatch`. Only this one file is ever read.
#[tauri::command]
fn load_genome(app: AppHandle) -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(path) = std::env::var("GLOWKIN_GENOME") {
        candidates.push(path.into());
    }
    candidates.push("genome.json".into());
    candidates.push("../genome.json".into());
    if let Some(dir) = state_dir(&app) {
        candidates.push(dir.join("genome.json"));
    }
    candidates.into_iter().find_map(|path| fs::read_to_string(path).ok())
}

/// Watch the cursor from a background thread. Polling natively is cheap; the
/// page is only woken when the cursor or the window actually moved.
fn watch_cursor(window: WebviewWindow, state: SharedState) {
    thread::spawn(move || {
        let mut passthrough: Option<bool> = None;
        let mut sent = (f64::NAN, f64::NAN);
        let mut pending = (0.0, 0.0);
        let mut last_emit = Instant::now();
        loop {
            let Shared { grab, hit } = *state.lock().unwrap();
            thread::sleep(Duration::from_millis(if grab.is_some() { 8 } else { 33 }));

            let (Ok(scale), Ok(cursor), Ok(mut pos)) =
                (window.scale_factor(), window.cursor_position(), window.outer_position())
            else {
                continue;
            };

            if let Some((gx, gy)) = grab {
                let nx = (cursor.x - gx * scale).round() as i32;
                let ny = (cursor.y - gy * scale).round() as i32;
                if (nx != pos.x || ny != pos.y)
                    && window.set_position(PhysicalPosition::new(nx, ny)).is_ok()
                {
                    pending.0 += f64::from(nx - pos.x) / scale;
                    pending.1 += f64::from(ny - pos.y) / scale;
                    pos = PhysicalPosition::new(nx, ny);
                }
            }

            let cx = (cursor.x - f64::from(pos.x)) / scale;
            let cy = (cursor.y - f64::from(pos.y)) / scale;
            let over = grab.is_some()
                || hit.is_some_and(|(hx, hy, r)| (cx - hx).hypot(cy - hy) < r);
            if passthrough != Some(!over) && window.set_ignore_cursor_events(!over).is_ok() {
                passthrough = Some(!over);
            }

            // A far-away cursor only steers the eyes, so it needs fewer updates.
            let far = hit.is_some_and(|(hx, hy, _)| (cx - hx).hypot(cy - hy) > 500.0);
            let wait = if grab.is_some() { 16 } else if far { 120 } else { 33 };
            let changed = pending != (0.0, 0.0)
                || (cx - sent.0).abs() > 0.5
                || (cy - sent.1).abs() > 0.5
                || sent.0.is_nan();
            if changed && last_emit.elapsed() >= Duration::from_millis(wait) {
                let tick = Tick { cx, cy, dx: pending.0, dy: pending.1, over };
                if window.emit("tick", tick).is_ok() {
                    sent = (cx, cy);
                    pending = (0.0, 0.0);
                    last_emit = Instant::now();
                }
            }
        }
    });
}

/// Put the window where it was last left, or bottom-right on first run.
fn place_window(app: &AppHandle, window: &WebviewWindow) -> tauri::Result<()> {
    let size = window.outer_size()?;
    let (w, h) = (size.width as i32, size.height as i32);
    let saved = state_dir(app)
        .and_then(|dir| fs::read_to_string(dir.join("overlay.json")).ok())
        .and_then(|text| serde_json::from_str::<Saved>(&text).ok());
    if let Some(s) = saved {
        // Only trust the saved spot if the creature's body would still be on a screen.
        let (cx, cy) = (s.x + w / 2, s.y + h / 3);
        let on_screen = window.available_monitors()?.iter().any(|m| {
            let (p, sz) = (m.position(), m.size());
            cx >= p.x && cx < p.x + sz.width as i32 && cy >= p.y && cy < p.y + sz.height as i32
        });
        if on_screen {
            return window.set_position(PhysicalPosition::new(s.x, s.y));
        }
    }
    if let Some(m) = window.primary_monitor()? {
        let (p, sz) = (m.position(), m.size());
        let margin = (24.0 * m.scale_factor()) as i32;
        let x = p.x + sz.width as i32 - w - margin;
        let y = p.y + sz.height as i32 - h - margin * 2;
        window.set_position(PhysicalPosition::new(x, y))?;
    }
    Ok(())
}

fn main() {
    let state: SharedState = Arc::default();
    tauri::Builder::default()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![set_hit, grab_start, grab_end, load_genome])
        .setup(move |app| {
            let handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                place_window(&handle, &window)?;
                window.show()?;
                watch_cursor(window, state.clone());
            }

            let quit = MenuItem::with_id(app, "quit", "Quit glowkin", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;
            let mut tray = TrayIconBuilder::new().menu(&menu).tooltip("glowkin");
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, event| {
                if event.id.as_ref() == "quit" {
                    app.exit(0);
                }
            })
            .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running glowkin");
}

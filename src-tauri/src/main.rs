#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod connection;
mod drivers;
mod error;
mod query;
mod schema;
mod state;
mod utils;

use state::AppState;
use tauri::Manager;
use std::panic;
use std::fs;
use std::io::Write;

fn main() {
    // ── Global panic hook: always write crash log before exit ──
    let default_hook = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        // Write crash log to a timestamped file next to the binary
        let now = chrono::Local::now();
        let ts = now.format("%Y%m%d_%H%M%S");
        let msg = format!("{}", info);

        // Try several locations
        let paths: Vec<Option<std::path::PathBuf>> = vec![
            std::env::current_dir().ok().map(|d| d.join(format!("dbdog-crash-{ts}.log"))),
            Some(std::env::temp_dir().join(format!("dbdog-crash-{ts}.log"))),
        ];

        let mut written = false;
        for path in paths.into_iter().flatten() {
            if let Ok(mut f) = fs::File::create(&path) {
                let _ = writeln!(f, "DBDog crash log — {now}");
                let _ = writeln!(f, "{msg}");
                let _ = writeln!(f, "---");
                if let Some(loc) = info.location() {
                    let _ = writeln!(f, "Location: {loc}");
                }
                written = true;
                eprintln!("Crash log written to: {}", path.display());
                break;
            }
        }

        if !written {
            eprintln!("DBDog CRASH (could not write log file): {msg}");
        }

        // Invoke the default hook (prints to stderr + exits)
        default_hook(info);
    }));

    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(AppState::new(handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connection::list_connections,
            commands::connection::save_connection,
            commands::connection::delete_connection,
            commands::connection::test_connection,
            commands::connection::connect,
            commands::connection::disconnect,
            commands::query::execute_query,
            commands::query::execute_update,
            commands::query::cancel_query,
            commands::schema::get_databases,
            commands::schema::get_tables,
            commands::schema::get_table_details,
            commands::schema::refresh_schema,
            commands::schema::search_schema,
            commands::memcached::memcached_list_keys,
            commands::memcached::memcached_get_item,
            commands::memcached::memcached_delete_item,
            commands::memcached::memcached_flush_all,
            commands::memcached::memcached_get_stats,
            commands::zookeeper::zookeeper_list_children,
            commands::zookeeper::zookeeper_get_node,
            commands::zookeeper::zookeeper_create_node,
            commands::zookeeper::zookeeper_delete_node,
            commands::zookeeper::zookeeper_set_data,
            commands::zookeeper::zookeeper_get_tree,
            commands::zookeeper::zookeeper_get_server_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

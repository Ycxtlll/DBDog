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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

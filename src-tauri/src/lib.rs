mod cache;
mod commands;
mod config;
mod db;
mod error;
mod state;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub async fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");

            // Ensure data dir exists
            std::fs::create_dir_all(&app_data_dir).ok();

            let connection_manager = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current().block_on(async {
                    config::connections::ConnectionManager::new(app_data_dir)
                        .await
                        .expect("Failed to initialize connection manager")
                })
            });

            let state = AppState::new(connection_manager);
            app.manage(state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Connection
            commands::connection::test_connection,
            commands::connection::save_connection,
            commands::connection::list_connections,
            commands::connection::delete_connection,
            commands::connection::connect,
            commands::connection::disconnect,
            // Query
            commands::query::execute_query,
            commands::query::execute_update,
            commands::query::cancel_query,
            commands::query::explain_query,
            // Schema
            commands::schema::list_databases,
            commands::schema::list_tables,
            commands::schema::describe_table,
            commands::schema::get_create_table_sql,
            commands::schema::refresh_schema,
            // Metadata
            commands::metadata::get_columns,
            commands::metadata::get_indexes,
            commands::metadata::get_foreign_keys,
            commands::metadata::get_triggers,
            commands::metadata::list_views,
            // Health
            commands::health::get_process_list,
            commands::health::get_status_variables,
            commands::health::get_system_variables,
            commands::health::get_innodb_status,
            commands::health::kill_process,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

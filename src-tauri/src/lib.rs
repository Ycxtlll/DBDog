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
    let app = tauri::Builder::default()
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
                .unwrap_or_else(|_| std::path::PathBuf::from("."));

            let connection_manager = tokio::runtime::Handle::current()
                .block_on(config::connections::ConnectionManager::new(app_data_dir.clone()))
                .expect("Failed to initialize connection manager");

            let state = AppState::new(connection_manager, app_data_dir);
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connection::test_connection,
            commands::connection::save_connection,
            commands::connection::list_connections,
            commands::connection::delete_connection,
            commands::connection::connect,
            commands::connection::disconnect,
            commands::query::execute_query,
            commands::query::execute_update,
            commands::query::cancel_query,
            commands::query::explain_query,
            commands::schema::list_databases,
            commands::schema::list_tables,
            commands::schema::describe_table,
            commands::schema::get_create_table_sql,
            commands::schema::search_schema,
            commands::schema::refresh_schema,
            commands::metadata::get_columns,
            commands::metadata::get_indexes,
            commands::metadata::get_foreign_keys,
            commands::metadata::get_triggers,
            commands::metadata::list_views,
            commands::health::get_process_list,
            commands::health::get_status_variables,
            commands::health::get_system_variables,
            commands::health::get_innodb_status,
            commands::health::kill_process,
            commands::history::add_history_entry,
            commands::history::get_history,
            commands::history::search_history,
            commands::history::create_bookmark,
            commands::history::update_bookmark,
            commands::history::get_bookmarks,
            commands::history::delete_bookmark,
            commands::history::get_bookmark_folders,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {});
}

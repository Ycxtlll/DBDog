use crate::connection::model::DatabaseType;
use crate::drivers::zookeeper::{ZkChildList, ZkDriver, ZkNode, ZkServerInfo, ZkTreeNode};
use crate::error::AppError;
use crate::state::AppState;
use uuid::Uuid;

#[tauri::command]
pub async fn zookeeper_list_children(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    path: Option<String>,
) -> Result<ZkChildList, AppError> {
    let config = state.get_config(&connection_id).await?;
    if config.db_type != DatabaseType::Zookeeper {
        return Err(AppError::DriverNotSupported(
            "此操作仅支持 ZooKeeper 连接".into(),
        ));
    }
    ZkDriver::list_children(&config, path.unwrap_or_else(|| "/".into()).as_str()).await
}

#[tauri::command]
pub async fn zookeeper_get_node(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    path: String,
) -> Result<ZkNode, AppError> {
    let config = state.get_config(&connection_id).await?;
    if config.db_type != DatabaseType::Zookeeper {
        return Err(AppError::DriverNotSupported(
            "此操作仅支持 ZooKeeper 连接".into(),
        ));
    }
    ZkDriver::get_node(&config, &path).await
}

#[tauri::command]
pub async fn zookeeper_create_node(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    path: String,
    data: String,
    ephemeral: bool,
    sequential: bool,
) -> Result<String, AppError> {
    let config = state.get_config(&connection_id).await?;
    if config.db_type != DatabaseType::Zookeeper {
        return Err(AppError::DriverNotSupported(
            "此操作仅支持 ZooKeeper 连接".into(),
        ));
    }
    ZkDriver::create_node(&config, &path, &data, ephemeral, sequential).await
}

#[tauri::command]
pub async fn zookeeper_delete_node(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    path: String,
) -> Result<(), AppError> {
    let config = state.get_config(&connection_id).await?;
    if config.db_type != DatabaseType::Zookeeper {
        return Err(AppError::DriverNotSupported(
            "此操作仅支持 ZooKeeper 连接".into(),
        ));
    }
    ZkDriver::delete_node(&config, &path).await
}

#[tauri::command]
pub async fn zookeeper_set_data(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    path: String,
    data: String,
) -> Result<ZkNode, AppError> {
    let config = state.get_config(&connection_id).await?;
    if config.db_type != DatabaseType::Zookeeper {
        return Err(AppError::DriverNotSupported(
            "此操作仅支持 ZooKeeper 连接".into(),
        ));
    }
    ZkDriver::set_data(&config, &path, &data).await
}

#[tauri::command]
pub async fn zookeeper_get_tree(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    path: Option<String>,
    max_depth: Option<u32>,
) -> Result<ZkTreeNode, AppError> {
    let config = state.get_config(&connection_id).await?;
    if config.db_type != DatabaseType::Zookeeper {
        return Err(AppError::DriverNotSupported(
            "此操作仅支持 ZooKeeper 连接".into(),
        ));
    }
    ZkDriver::get_tree(
        &config,
        &path.unwrap_or_else(|| "/".into()),
        max_depth.unwrap_or(3),
    )
    .await
}

#[tauri::command]
pub async fn zookeeper_get_server_info(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
) -> Result<ZkServerInfo, AppError> {
    let config = state.get_config(&connection_id).await?;
    if config.db_type != DatabaseType::Zookeeper {
        return Err(AppError::DriverNotSupported(
            "此操作仅支持 ZooKeeper 连接".into(),
        ));
    }
    ZkDriver::get_server_info(&config).await
}

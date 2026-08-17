use dbdog_lib::connection::model::{ConnectionConfig, DatabaseType};
use dbdog_lib::drivers::memcached::MemcachedDriver;
use uuid::Uuid;

fn test_config() -> ConnectionConfig {
    ConnectionConfig {
        id: Uuid::new_v4(),
        name: "test".into(),
        db_type: DatabaseType::Memcached,
        host: "localhost".into(),
        port: 11211,
        username: String::new(),
        password: None,
        database: None,
        max_connections: None,
        ssl_mode: None,
        ssl_cert_path: None,
        password_hash: None,
        group: None,
    }
}

#[tokio::test]
async fn should_test_connection() {
    let result = MemcachedDriver::test(&test_config()).await;
    assert!(result.is_ok(), "test failed: {:?}", result.err());
    let version = result.unwrap();
    assert!(version.contains("memcached"), "unexpected version: {version}");
}

#[tokio::test]
async fn should_get_stats() {
    let info = MemcachedDriver::get_stats(&test_config())
        .await
        .expect("get_stats failed");
    assert!(!info.version.is_empty());
    assert!(info.curr_items > 0, "expected curr_items > 0");
    assert!(info.bytes_used > 0);
}

#[tokio::test]
async fn should_list_keys() {
    let result = MemcachedDriver::list_keys(&test_config(), None)
        .await
        .expect("list_keys failed");
    assert!(result.total_keys > 0, "expected some keys");
    assert!(!result.keys.is_empty());
    // total_keys is the true count; the returned list is capped at 5000.
    assert_eq!(result.keys.len(), result.total_keys.min(5000));
}

#[tokio::test]
async fn should_search_keys() {
    let all = MemcachedDriver::list_keys(&test_config(), None)
        .await
        .expect("list_keys failed");
    if all.keys.is_empty() {
        return;
    }
    let first = &all.keys[0];
    let search_term = if first.len() > 2 {
        &first[1..first.len() - 1]
    } else {
        first
    };
    let result = MemcachedDriver::list_keys(&test_config(), Some(search_term))
        .await
        .expect("search failed");
    assert!(
        result.keys.iter().any(|k| k == first),
        "expected to find key {first} when searching '{search_term}'"
    );
}

#[tokio::test]
async fn should_get_item() {
    let keys = MemcachedDriver::list_keys(&test_config(), None)
        .await
        .expect("list_keys failed");
    if keys.keys.is_empty() {
        return;
    }
    let key = &keys.keys[0];
    let item = MemcachedDriver::get_item(&test_config(), key)
        .await
        .expect("get_item failed");
    assert_eq!(item.key, *key);
    assert!(item.size_bytes > 0);
    assert!(item.value.is_some());
}

#[tokio::test]
async fn should_return_error_for_missing_key() {
    let result = MemcachedDriver::get_item(&test_config(), "__dbdog_nonexistent_test__").await;
    assert!(result.is_err());
}

#[tokio::test]
async fn should_delete_nonexistent_key() {
    let result =
        MemcachedDriver::delete_item(&test_config(), "__dbdog_nonexistent_test__").await;
    assert!(result.is_err());
}

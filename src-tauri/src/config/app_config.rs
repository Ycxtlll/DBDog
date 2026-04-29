use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub theme: String,
    pub language: String,
    pub font_size: u32,
    pub default_query_limit: u64,
    pub editor_tab_size: u32,
    pub editor_vim_mode: bool,
    pub editor_autocomplete_delay_ms: u64,
    pub connection_timeout_secs: u64,
    pub cache_ttl_secs: u64,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            language: "en".to_string(),
            font_size: 14,
            default_query_limit: 1000,
            editor_tab_size: 2,
            editor_vim_mode: false,
            editor_autocomplete_delay_ms: 300,
            connection_timeout_secs: 10,
            cache_ttl_secs: 300,
        }
    }
}

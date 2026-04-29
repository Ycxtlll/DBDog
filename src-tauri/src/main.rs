#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(dbdog_lib::run());
}

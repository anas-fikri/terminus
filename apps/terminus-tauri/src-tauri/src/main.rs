// Tauri entry point for desktop binary.
// All logic lives in lib.rs so mobile can share it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    terminus_tauri_lib::run();
}

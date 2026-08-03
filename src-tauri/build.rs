fn main() {
    println!("cargo:rerun-if-env-changed=CATWALK_UPDATER_PUBKEY");
    tauri_build::build();
}

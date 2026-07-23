use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
};

fn main() {
    println!("cargo:rerun-if-changed=src/after_effects/arizona_actions.jsx");
    println!("cargo:rerun-if-changed=../scripts/build-after-effects-jsxbin.mjs");

    if env::var("PROFILE").as_deref() == Ok("release") {
        build_after_effects_jsxbin();
    }

    tauri_build::build()
}

fn build_after_effects_jsxbin() {
    let manifest_directory =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR ausente"));
    let repository_root = manifest_directory
        .parent()
        .expect("src-tauri precisa estar dentro da raiz do repositorio");
    let generator = repository_root
        .join("scripts")
        .join("build-after-effects-jsxbin.mjs");
    let output_directory = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR ausente"))
        .join("after-effects-jsxbin");

    let status = Command::new(node_executable())
        .arg(&generator)
        .arg("--output")
        .arg(&output_directory)
        .current_dir(repository_root)
        .status()
        .unwrap_or_else(|err| {
            panic!(
                "Nao foi possivel iniciar a geracao do JSXBIN por {}: {err}",
                generator.display()
            )
        });

    if !status.success() {
        panic!(
            "A geracao do JSXBIN do After Effects falhou com status {status}. Rode npm install na raiz e tente novamente."
        );
    }
}

fn node_executable() -> &'static Path {
    if cfg!(windows) {
        Path::new("node.exe")
    } else {
        Path::new("node")
    }
}

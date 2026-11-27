//! Compiles the Objective-C++ libmpv bridge. The mpv headers are the ones
//! vendored for the Electron embed, so both players build against the same API.
fn main() {
    let headers = "../desktop/native/mpv-embed/include";
    println!("cargo:rerun-if-changed=native/plexy_mpv.mm");
    println!("cargo:rerun-if-changed={headers}/mpv");
    cc::Build::new()
        .cpp(true)
        .file("native/plexy_mpv.mm")
        .include(headers)
        .flag("-std=c++17")
        .flag("-fobjc-arc")
        .flag("-Wno-deprecated-declarations")
        .compile("plexy_mpv");
    for framework in ["AppKit", "OpenGL", "QuartzCore", "Foundation"] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    println!("cargo:rustc-link-lib=c++");

    // Embed every icon in assets/icons (extracted from the web app by
    // tools/extract-icons.ts).
    println!("cargo:rerun-if-changed=assets/icons");
    let mut names: Vec<String> = std::fs::read_dir("assets/icons")
        .expect("assets/icons")
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.ends_with(".svg"))
        .collect();
    names.sort();
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let entries: String = names
        .iter()
        .map(|n| format!("(\"icons/{n}\", include_bytes!(\"{manifest}/assets/icons/{n}\")),\n"))
        .collect();
    let out = std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("icons.rs");
    std::fs::write(out, format!("const ICONS: &[(&str, &[u8])] = &[\n{entries}];\n")).unwrap();
}

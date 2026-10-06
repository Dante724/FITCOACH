# DeepFilterNet3 for calls — how `public/dfn3` was built

Everything here comes from the official DeepFilterNet repository (MIT / Apache-2.0):
https://github.com/Rikorose/DeepFilterNet — commit `d375b2d8309e0935d165700c91da9de862a99c31` (17 Oct 2024).

| File | What it is | SHA-256 |
|---|---|---|
| `DeepFilterNet3_onnx.tar.gz` | the trained model, copied unchanged from `models/` in the repo | `c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616` |
| `df_bg.wasm.gz` | the engine (`libDF`, tract ONNX runtime) compiled to WebAssembly, then `gzip -9 -n` | `75416460a44edf0df54ab0a0045d9c6df7afaf3696ed4fb45ca7b77de456ccd8` (uncompressed `81849ed7166ecca04a638f7c1cf8cd22c784311460df1d8404b5fa478f3778c2`) |
| `dfn3Worklet.js` | `prelude.js` + generated `df.js` + `processor.js` from this folder | — |

## Rebuild

```sh
brew install rustup wasm-pack
rustup toolchain install 1.81.0 && rustup target add wasm32-unknown-unknown --toolchain 1.81.0
cargo install wasm-bindgen-cli --version 0.2.92 --locked
git clone https://github.com/Rikorose/DeepFilterNet && cd DeepFilterNet && git checkout d375b2d
# one change: in libDF/Cargo.toml remove "default-model" from the `wasm` feature (we load the model file separately,
# so it isn't baked into the engine twice)
scripts/dfn3/build.sh /path/to/DeepFilterNet     # run from frontend/
```

Notes
- Rust 1.81 is used because the pinned `wasm-bindgen` 0.2.92 predates Rust 1.82's WebAssembly changes.
- The repo's `Cargo.lock` is slightly out of date upstream (demo-app crates); cargo refreshes those, but every crate the
  engine uses (tract 0.21.4, wasm-bindgen 0.2.92, js-sys 0.3.69, ndarray 0.15.6, rustfft 6.2.0, flate2 1.0.30, tar 0.4.40)
  stays at the pinned version.
- Without `wasm-opt`; size is fine (2.5 MB gzipped).

#!/bin/sh -e
# Rebuilds public/dfn3 from the official DeepFilterNet source. See BUILD.md. Usage: scripts/dfn3/build.sh /path/to/DeepFilterNet
SRC="$1"; HERE="$(cd "$(dirname "$0")" && pwd)"; OUT="$HERE/../../public/dfn3"
mkdir -p "$OUT"
if [ -n "$SRC" ]; then
  (cd "$SRC/libDF" && RUSTUP_TOOLCHAIN=1.81.0 wasm-pack build --release --mode no-install --target no-modules --features wasm)
  cp "$SRC/libDF/pkg/df.js" "$HERE/df.js"
  gzip -9 -n -c "$SRC/libDF/pkg/df_bg.wasm" > "$OUT/df_bg.wasm.gz"
  cp "$SRC/models/DeepFilterNet3_onnx.tar.gz" "$OUT/DeepFilterNet3_onnx.tar.gz"
  cp "$SRC/LICENSE-MIT" "$OUT/LICENSE-MIT"; cp "$SRC/LICENSE-APACHE" "$OUT/LICENSE-APACHE"
fi
cat "$HERE/prelude.js" "$HERE/df.js" "$HERE/processor.js" > "$OUT/dfn3Worklet.js"
echo "public/dfn3 ready"

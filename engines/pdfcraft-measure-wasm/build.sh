#!/usr/bin/env bash
# Rebuilds the PdfCraft measuring engine for the browser. Requires Rust >= 1.95 + wasm32 target + wasm-pack.
set -euo pipefail
SHA=0a0986483378b57d62103a36490bd66166d32c8f
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$ROOT/vendor"
[ -d "$ROOT/vendor/pdfcraft" ] || git clone https://github.com/storytold/pdfcraft "$ROOT/vendor/pdfcraft"
git -C "$ROOT/vendor/pdfcraft" fetch --depth 1 origin $SHA && git -C "$ROOT/vendor/pdfcraft" -c advice.detachedHead=false checkout $SHA
cd "$(dirname "$0")"
wasm-pack build --target web --release --no-opt
cp pkg/pitch_pdfcraft_measure_bg.wasm "$ROOT/public/wasm/"
cp pkg/pitch_pdfcraft_measure.js pkg/pitch_pdfcraft_measure.d.ts "$ROOT/src/lib/wasm/pitch_pdfcraft_measure/"
sed -i "s#new URL('pitch_pdfcraft_measure_bg.wasm', import.meta.url)#'/wasm/pitch_pdfcraft_measure_bg.wasm'#" "$ROOT/src/lib/wasm/pitch_pdfcraft_measure/pitch_pdfcraft_measure.js"

#!/bin/sh
# Builds media/vp-audio.wasm (the built-in sound decoder). Needs Rust with the wasm32-unknown-unknown target:
#   rustup target add wasm32-unknown-unknown
set -e
cd "$(dirname "$0")"
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/vp_audio.wasm ../media/vp-audio.wasm
ls -l ../media/vp-audio.wasm

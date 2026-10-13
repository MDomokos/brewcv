#!/bin/sh
# scripts/flatpak-sources.sh
# Regenerates flatpak/cargo-sources.json from src-tauri/Cargo.lock (run after Cargo.lock changes).
# Needs python3 and `pip install aiohttp tomlkit` (a venv is fine).
set -eu
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
curl -fsSL -o "$tmp/flatpak-cargo-generator.py" https://raw.githubusercontent.com/flatpak/flatpak-builder-tools/master/cargo/flatpak-cargo-generator.py
python3 "$tmp/flatpak-cargo-generator.py" src-tauri/Cargo.lock -o flatpak/cargo-sources.json
rm -rf "$tmp"

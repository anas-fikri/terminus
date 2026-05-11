# Terminus

Terminus is a Tauri + Vite desktop workspace app focused on daily development flow:
- multi-project context
- terminal-first workflow
- file explorer + viewer
- browser preview/inspect bridge
- AI-assisted interaction inside sessions

This repository uses a Rust workspace with a Tauri app in apps/terminus-tauri.

## Acknowledgement

The core idea for this project was inspired by termul from gnoviawan:
https://github.com/gnoviawan/termul

With the highest respect and appreciation to gnoviawan for the original work and inspiration.

## Project Structure

- apps/terminus-tauri: main desktop app (frontend + Tauri backend)
- crates/terminus-core: shared Rust core crate
- examples: sample resources
- target: build output

## Requirements

- Node.js 18+
- npm 9+
- Rust toolchain (stable)
- Tauri prerequisites for your OS

On macOS, install Xcode Command Line Tools:

```bash
xcode-select --install
```

## Quick Start (Development)

From repository root:

```bash
cd apps/terminus-tauri
npm install
npm run tauri dev
```

If default port is in use, use safe dev startup:

```bash
npm run tauri:dev:safe
```

## Build

From repository root:

```bash
cd apps/terminus-tauri
```

Build app bundle only:

```bash
npm run tauri -- build --bundles app
```

Build mac app + dmg:

```bash
npm run build:mac
```

Build mac app + pkg installer (recommended for install flow):

```bash
npm run build:mac:installer
```

## Build Output Paths

After successful build, output artifacts are under:

- macOS app: target/release/bundle/macos/Terminus.app
- macOS pkg installer: target/release/bundle/pkg/Terminus_0.1.0_aarch64.pkg
- macOS dmg: target/release/bundle/dmg/

## Why DMG Looks Like "Mount Only"

DMG is a disk image container. Opening DMG usually mounts a volume and shows app files to drag/copy.
If you want a click-through installer experience, use the PKG output.

## Type Check

```bash
cd apps/terminus-tauri
npx tsc --noEmit
```

## Common Troubleshooting

1. Dev server fails to start
- Run npm run tauri:dev:safe to auto-pick an available port.

2. Tauri build fails on macOS
- Ensure Xcode CLI tools are installed.
- Re-run build with app-only target first:
  - npm run tauri -- build --bundles app

3. Rust toolchain issues
- Verify Rust install:
  - rustup show

## Notes for GitHub CI

For multi-OS binary automation via GitHub Actions workflow changes,
make sure your GitHub token has workflow scope when pushing workflow files.

## License

Internal project. Add your preferred license before public distribution.

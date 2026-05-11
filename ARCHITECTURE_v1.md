# Architecture Deep-Dive v1
## Terminus Runtime (Rust Core + TypeScript UI/Tauri)

Status: Draft v1.2  
Last Updated: May 11, 2026

---

## 1. Objective

Dokumen ini menjabarkan arsitektur implementasi untuk requirement di PRD v1.1:
- stabil dan dinamis,
- minim memory leak,
- multi-project dengan boundary kuat,
- multi-tab + tree explorer + resizable layout,
- GitHub + custom GitLab,
- status AI real-time,
- settings level aplikasi + per-project,
- integrasi MCP + Skill runtime.

---

## 2. System Overview

Arsitektur dibagi menjadi 2 domain:

1. Rust Core Runtime
- Menangani orchestration, routing model, cache, budget, token optimizer, monitoring, sandbox project, MCP, skill, git connectors.
- Memory safety by default (ownership model Rust).

2. Tauri UI (TypeScript)
- Menangani shell desktop: tabs, explorer, panel resize, inspector, status UI, settings UI.
- Komunikasi ke core via typed IPC command/event.

Model komunikasi:
- Command path: UI -> IPC Command -> Core Service -> Response
- Event path: Core -> Event Bus -> UI realtime update

---

## 3. Process Model

## 3.1 Core Threads/Tasks

- Main runtime: command dispatcher.
- Async workers (Tokio):
  - inference worker pool,
  - cache + storage writer,
  - monitoring aggregator,
  - git connector worker,
  - MCP client worker.

Threading policy:
- CPU-heavy task (embedding/token calc) di dedicated worker pool.
- I/O-heavy task (provider call, DB, git network) async non-blocking.

## 3.2 Request Pipeline (Detailed)

1. Validate workspace/project context.
2. Load effective config (CLI > project > app > default).
3. Token preflight + projected cost.
4. Semantic cache lookup.
5. Budget guard check.
6. Model selection (routing policy).
7. Optional MCP tool injection.
8. Prompt optimization (mode aware).
9. Provider inference + fallback chain.
10. Persist cache + audit + metrics.
11. Stream response and state events to UI.

---

## 4. Module Boundaries

## 4.1 Core Crates (Rust)

1. core-app
- Bootstrap runtime, dependency wiring, lifecycle.

2. core-config
- Parse/validate app config + project config.
- Resolve precedence and produce EffectiveConfig.

3. core-sandbox
- Project boundary isolation, permission checks, scoped resources.

4. core-model-gateway
- Provider adapter trait + implementations.
- Model registry + routing policy.

5. core-cost-engine
- Semantic cache, dedup, budget guard, token optimizer.

6. core-mcp
- MCP discovery, tool invocation, permission guard.

7. core-skill
- Skill manifest parsing + execution graph.

8. core-git
- GitHub/GitLab auth abstraction, repo operations.

9. core-monitoring
- Metrics, audit logs, event export.

10. core-ipc
- Typed command/event contracts for Tauri.

11. core-storage
- SQLite repositories, migration, transaction policy.

## 4.2 UI Packages (TypeScript)

1. ui-shell
- Window management, tabs, split panes, drag-resize layout.

2. ui-explorer
- Project tree explorer + scoped file actions.

3. ui-terminal
- Terminal sessions + AI chat streams.

4. ui-inspector
- Browser inspector + selector extraction.

5. ui-settings
- App settings + project settings.

6. ui-status
- AI state badges, progress bars, elapsed timer, cancel action.

7. ui-state
- Global state store (session/tab/layout/provider status).

8. ui-search
- Global search overlay, fuzzy index, command palette.

9. ui-notification
- Toast system, notification center, DND mode.

10. ui-design-system
- Shared component library: Button, Badge, Modal, Toast, Tooltip, Icon, Sidebar, Tabs, Panel, Input, Select, Toggle, Progress, Spinner, EmptyState.
- Design tokens: color, spacing, typography, radius, shadow.

---

## 4.3 UI Design System + Component Library

Design token structure:
- colors: primary, secondary, surface, border, text-primary, text-secondary, text-disabled, status-info, status-success, status-warning, status-error.
- spacing: 4px base unit, scale: 4, 8, 12, 16, 24, 32, 48, 64.
- typography: font-family (system-ui), size-scale (11, 12, 14, 16, 18, 22, 28).
- radius: 4, 8, 12, 16.
- shadow: none, sm, md, lg.

Density modes:
- compact: spacing scale x0.75.
- comfortable (default): spacing scale x1.
- spacious: spacing scale x1.25.

Dark/light mode:
- tokens split ke color-light.json dan color-dark.json.
- system follows OS preference by default, user dapat override.

Component rules:
- Semua component accessible: role, aria-label, keyboard handler.
- Loading state built-in pada komponen async (Button, Panel, etc).
- Error state built-in: border merah + helper text.

---

## 4.4 Error Boundary Strategy (UI)

Error boundary level:
1. Root boundary: tangkap error tidak terduga, tampilkan recovery screen.
2. Tab boundary: tab crash tidak crash tab lain, tampilkan error state per tab.
3. Panel boundary: panel crash tampilkan placeholder error dengan reload action.
4. Component boundary: error di komponen anak tidak naik ke parent.

Error recovery UX:
- Tampilkan pesan humanis: "Terjadi masalah di panel ini."
- Sediakan aksi: Reload Panel, Buka Log Error, Laporkan Bug.
- Simpan error ke core-monitoring untuk audit.

Error types:
- NetworkError: provider/git timeout → tampilkan retry + last known state.
- PermissionError: sandbox violation → tampilkan permission prompt.
- ConfigError: config invalid → tampilkan inline fix suggestion.
- RuntimeError: unexpected → boundary catch + report.

---

## 5. Project Boundary Isolation Design

Isolation unit: ProjectId + WorkspaceRoot.

Every resource is namespaced:
- cache: cache_{project_id}
- audit: audit_{project_id}
- budget: budget_{project_id}
- skill storage: .terminus/skills
- temp files: .terminus/tmp

Hard constraints:
- Explorer cannot access parent/sibling project by default.
- MCP tools default scoped to active workspace.
- Cross-project action requires explicit runtime permission grant.

Permission bridge flow:
1. Request cross-project operation.
2. Core creates PermissionPrompt event.
3. UI shows confirm modal (allow once/allow session/deny).
4. Decision persisted in project permission policy.

---

## 6. Memory Safety and Leak Prevention

## 6.1 Preventive Design

- Rust ownership and borrow rules as base line.
- Avoid long-lived Arc cycles (use Weak references for parent links).
- Bounded channels for event streaming to prevent unbounded queue growth.
- Request-scoped context object dropped at end of pipeline.
- Pool limits for workers, tabs, and inspector sessions.

## 6.2 Runtime Guardrails

- Memory watermark monitor in core-monitoring.
- Automatic warning on growth trend anomaly.
- Backpressure strategy when queue exceeds threshold.
- Hard cap for in-memory cache; spill to SQLite.

## 6.3 Test Strategy

- Soak test 24h with synthetic workload.
- Leak check in CI (massif/heaptrack on Linux CI runner).
- Scenario tests:
  - open/close 1000 tabs,
  - run 10k inference requests,
  - rapid panel resize and inspector sessions.

SLO memory:
- Memory growth slope must flatten after warm-up window.

---

## 7. IPC Contract (Tauri)

## 7.1 Commands (UI -> Core)

- run_ask(RequestPayload) -> StreamId
- cancel_run(StreamId) -> Ack
- list_projects() -> ProjectSummary[]
- set_active_project(ProjectId) -> Ack
- get_tree(ProjectId, Path) -> TreeNode[]
- run_git_op(GitOpRequest) -> GitOpResult
- run_mcp_tool(ToolCallRequest) -> ToolCallResult
- run_skill(SkillRunRequest) -> SkillRunResult
- get_effective_settings(ProjectId?) -> EffectiveSettings
- update_app_settings(AppSettingsPatch) -> Ack
- update_project_settings(ProjectSettingsPatch) -> Ack

## 7.2 Events (Core -> UI)

- ai_state_changed { streamId, state, elapsedMs }
- ai_token_cost_progress { streamId, estTokens, estCost, usedTokens, usedCost }
- stream_chunk { streamId, textChunk }
- stream_done { streamId, summary }
- provider_health_changed { provider, status, latencyP50, errorRate }
- budget_alert { projectId, threshold, currentSpend }
- permission_prompt { scope, action, resource }
- monitoring_snapshot { projectId, metrics }

AI states enum:
- loading
- working
- thinking
- tool-calling
- streaming
- done
- error

---

## 8. Data Model

## 8.1 Core Entities

- Project
  - id, name, root_path, provider_profile, created_at

- Session
  - id, project_id, tab_id, mode, started_at

- InferenceRun
  - id, project_id, provider, model, prompt_hash, started_at, ended_at, status

- CostRecord
  - run_id, input_tokens, output_tokens, total_cost_usd

- CacheEntry
  - key, project_id, embedding_hash, similarity_index, payload, ttl, created_at

- BudgetPolicy
  - project_id, daily_limit, monthly_limit, soft_thresholds

- SkillManifest
  - skill_id, version, inputs_schema, steps, dependencies

- MCPToolPolicy
  - project_id, tool_name, mode (allow/deny/confirm)

---

## 9. Desktop UX Architecture

## 9.1 Multi-Tab Model

Tab types:
- terminal tab,
- ai session tab,
- inspector tab,
- monitoring tab.

Tab persistence:
- save tab graph on app close.
- restore on startup per project.

## 9.2 Layout Engine

- Split tree model (binary split).
- Node contains panel id + size ratio.
- Drag-resize updates ratio in store.
- Save layout profile per project.

Presets:
- focus-coding
- focus-monitoring
- focus-inspect

## 9.3 Tree Explorer Safety

- Path normalization and canonical path checks.
- Deny traversal outside workspace root.
- Operation whitelist by scope.

---

## 9.4 Global Search Implementation

Search engine:
- In-process fuzzy search (tanpa server).
- Index per project: file paths, session titles, skill names, command list.
- Index rebuild: on project open, incremental on file change (debounced 500ms).

Search flow:
1. Trigger Cmd+K → ui-search overlay mount.
2. Query → fuzzy match pada index.
3. Results grouped: Files, Sessions, Skills, Commands.
4. Keyboard navigate → preview di side panel jika relevan.
5. Enter → navigate ke target.

Performance:
- Index max size: 100k entries.
- Search response: < 50ms untuk 100k entries.
- Index stored in-memory saat app aktif, serialized ke SQLite saat close.

---

## 9.5 Notification System Architecture

Notification flow:
1. Core emit event ke event bus.
2. core-ipc translate event ke NotificationPayload.
3. ui-notification receive → route ke toast atau notification center.

Toast lifecycle:
- Created → Visible → (auto-dismiss timer atau manual) → Dismissed → Logged ke center.
- Max toast visible sekaligus: 4.
- Stack order: newest on top.

Notification center:
- Backed by in-memory store + SQLite persistence.
- Max stored: 500 entries, FIFO eviction.
- Categories: budget, health, git, skill, mcp, system.

DND mode:
- User activate via toggle di header.
- Mode stored in app settings, persists across sessions.
- Override: critical error selalu toast bahkan dalam DND.

---

## 9.6 Keyboard Shortcut Registry

Registry architecture:
- Centralized shortcut map di ui-state.
- Shortcut = { id, description, keys: { mac, win }, handler }.
- Conflict detection saat register: log warning jika konflik.
- User dapat remap via settings UI (phase 2).

Shortcut scope:
- Global: berlaku di mana pun dalam app.
- Scoped: hanya aktif saat panel/komponen tertentu focused.

Conflict resolution:
- Scoped shortcut override global jika panel sedang focus.
- Log konflik ke console DEBUG, tidak crash.

---

## 9.7 Accessibility (a11y) Implementation

Target: WCAG 2.1 Level AA.

Komponen requirements:
- Semua interactive element: role attribute, aria-label atau aria-labelledby.
- Form inputs: aria-describedby untuk helper text + error.
- Modal: focus trap saat terbuka, restore focus saat tutup.
- Toast: role="alert" untuk screen reader announce.
- Tab: aria-selected, aria-controls.
- Loading spinner: aria-live="polite" atau aria-busy.

Color:
- Contrast ratio text normal: >= 4.5:1.
- Contrast ratio large text: >= 3:1.
- Jangan rely pada warna saja sebagai informasi (gunakan icon + teks juga).

Keyboard:
- Focus order mengikuti visual order.
- Focus ring: visible, minimal 2px solid.
- Escape: menutup modal/overlay.
- Tab/Shift+Tab: navigasi antar interactive element.

Ci test:
- axe-core dijalankan pada semua halaman utama dalam Playwright tests.
- a11y regression alert jika violation count meningkat.

---

## 10. Cross-Platform (Multi-OS) Architecture

## 10.1 Target Platforms

| OS | Arch | Distribution |
|----|------|--------------|
| macOS | arm64 (Apple Silicon) + x86_64 | .dmg (signed + notarized) |
| Windows | x86_64 | NSIS installer (.exe) |
| Linux | x86_64 + arm64 | AppImage + .deb |

## 10.2 Platform Abstraction Layer (core-platform)

Rust crate baru: core-platform
- Tujuan: semua OS-specific logic dirutekan ke sini. Modul lain tidak boleh pemanggilan OS API langsung.
- Interface:
  - secret_store: get/set/delete secrets (Keychain/Credential Manager/libsecret).
  - config_dir(): return platform-appropriate config path.
  - data_dir(): return platform-appropriate data path.
  - cache_dir(): return platform-appropriate cache path.
  - open_external(url): buka browser/file manager OS native.
  - send_notification(title, body, level): sistem notifikasi OS.
  - default_shell(): detect shell default user (zsh/bash/fish/pwsh/cmd).

Platform path resolution:
- macOS: ~/Library/Application Support/terminus/
- Windows: %APPDATA%\terminus\
- Linux: ~/.config/terminus/

## 10.3 Keychain Integration

- macOS: Security framework (Keychain Services).
- Windows: Windows Credential Manager API.
- Linux: libsecret (GNOME keyring) dengan fallback ke kwallet (KDE).
- Fallback terakhir: encrypted file dengan key dari OS user credentials.
- Library: `keyring` crate (cross-platform abstraction).

## 10.4 Keyboard Shortcut Normalization

- Tauri menggunakan accelerator string.
- Gunakan `CmdOrCtrl` sebagai modifier universal:
  - macOS: Cmd+K
  - Windows/Linux: Ctrl+K
- Jangan hardcode `Cmd` atau `Ctrl` langsung di config.
- Tampilkan shortcut di UI sesuai OS yang terdeteksi.

## 10.5 Shell Integration

- core-platform detect default shell saat startup.
- Terminal tab spawn shell yang sesuai:
  - macOS: zsh (default) atau bash/fish.
  - Linux: bash atau zsh.
  - Windows: PowerShell 7 (preferred) atau cmd.exe.
- User bisa override shell di settings.

## 10.6 OS Notification

- Gunakan Tauri notification plugin (cross-platform).
- macOS: Notification Center + permission request.
- Windows: Toast Notification (Win 10+).
- Linux: libnotify via D-Bus.
- Fallback: in-app notification center jika OS notification tidak tersedia/ditolak.

## 10.7 CI/CD Matrix

Build + test matrix:
- macOS-latest (arm64): build, unit test, integration test, E2E.
- windows-latest (x86_64): build, unit test, integration test.
- ubuntu-latest (x86_64): build, unit test, integration test.

Release pipeline:
- Tag push trigger: build semua 3 OS secara paralel.
- Artifacts: .dmg (macOS), .exe installer (Windows), .AppImage + .deb (Linux).
- Signing: macOS Apple Developer cert + notarize, Windows code signing cert.
- Publish ke GitHub Releases + update manifest endpoint.

---

## 11. Auto-Update Mechanism (Tauri)

Tauri Updater:
- Gunakan Tauri built-in updater dengan endpoint manifest.
- Manifest server: GitHub Releases atau self-hosted JSON.

Update flow:
1. App startup → cek versi dari manifest endpoint.
2. Jika update tersedia → download di background thread.
3. Core emit update_available event → UI tampilkan badge + notification.
4. User konfirmasi → apply + restart.
5. Jika user defer → check ulang setiap 24 jam.

Rollback:
- Simpan binary versi sebelumnya di app data dir.
- Jika crash saat startup post-update: auto rollback ke versi sebelumnya.
- Max 1 versi tersimpan (bukan full history).

Release channels:
- stable: production release.
- beta: opt-in feature preview.
- nightly: bleeding edge, tidak direkomendasikan untuk production.

Security:
- Signature verification wajib untuk setiap update bundle.
- HTTPS only untuk manifest + download.
- Reject update jika signature mismatch.

---

## 11. Git Connector Architecture

Git abstraction:
- Provider trait: auth(), listRepos(), clone(), fetch(), pull(), push(), branchOps(), getMergeInfo().

Implementations:
- github-provider
- gitlab-provider (custom base URL support)

Auth methods:
- PAT (MVP)
- OAuth device flow (phase 2)

Security:
- tokens encrypted in OS keychain integration.
- never log token/secrets.

Default permission policy:
- read-only git operations by default.
- write ops (push/merge action) require explicit user enable per project.

---

## 12. MCP + Skill Runtime Composition

Execution graph:
- skill step can call LLM, MCP tool, git op.
- each step has timeout, retry, cost tags.

Policy checks before step execution:
1. project boundary check,
2. tool permission check,
3. budget check,
4. sensitive operation check.

Failure mode:
- soft-fail for optional steps,
- hard-fail for required steps,
- structured error returned to UI.

---

## 13. Monitoring and Observability

Metrics categories:
- latency: p50, p95, p99 by provider/model/tool.
- reliability: error rate, timeout rate, fallback count.
- cost: token usage, spend by project/provider.
- efficiency: cache hit, dedup hit, compression gain.
- memory: rss, heap usage trend, queue depth.

Outputs:
- local dashboard API
- Prometheus endpoint
- CSV/JSON export
- webhook alerts

Audit log guarantees:
- append-only records
- project scoped
- searchable by run id/provider/date/status

---

## 14. Rollout Plan (Technical)

Phase A (Weeks 1-2)
- Core skeleton, IPC contracts, project sandbox, base config loader.

Phase B (Weeks 3-4)
- Model gateway + cost engine + monitoring base + UI status.

Phase C (Weeks 5-6)
- MCP + skill runtime + git connectors.

Phase D (Weeks 7-8)
- Desktop shell polish: tabs, explorer, resizable panes, inspector.
- Soak/perf tests and hardening.

---

## 15. Definition of Done

- Semua acceptance criteria PRD v1.2 pass.
- Soak test 24h pass tanpa memory growth abnormal.
- Project boundary penetration tests pass.
- GitHub dan custom GitLab integration pass.
- AI state transitions tampil akurat realtime.
- Config precedence deterministic dan teruji.
- a11y: axe-core zero critical violations di halaman utama.
- Keyboard: semua shortcut core bekerja tanpa konflik.
- Error boundary: tab crash tidak crash aplikasi.
- Update: signature verification pass sebelum apply.

---

## Changelog

| Versi | Tanggal | Perubahan |
|-------|---------|----------|
| v1.0 | May 11, 2026 | Draft awal: arsitektur 2-domain, module crates, IPC contract, data model, memory safety, monitoring |
| v1.2 | May 11, 2026 | Tambah: ui-search + ui-notification + ui-design-system packages (4.2), Design System section (4.3), Error Boundary strategy (4.4), Global Search impl (9.4), Notification architecture (9.5), Keyboard Registry (9.6), a11y implementation (9.7), Auto-Update Mechanism (10), renumber section 11-15 |
| v1.3 | May 11, 2026 | Tambah: Section 10 Cross-Platform Multi-OS Architecture (platform abstraction layer, keychain integration, shell detection, OS notification, CI/CD matrix 3 OS); renumber Auto-Update ke 11, Git ke 12, dll |

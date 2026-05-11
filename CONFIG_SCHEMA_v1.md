# Config Schema v1
## Terminus App Settings + Project Settings

Status: Draft v1.2  
Last Updated: May 11, 2026

---

## 1. Goals

Schema ini mendefinisikan:
- setting aplikasi (global),
- setting per project,
- aturan precedence,
- boundary + permission policy,
- format yang siap diparse Rust core.

Format utama: YAML.

---

## 2. File Locations

Global app config:
- ~/.terminus/config.yaml

Project config:
- <workspace>/.terminus.yaml

Local secrets (encrypted pointer only):
- ~/.terminus/secrets/index.json
- actual secret disimpan di OS keychain (recommended)

Optional overrides (runtime flags):
- CLI flags saat command dijalankan.

---

## 3. Precedence Rules

Urutan prioritas tertinggi ke terendah:
1. CLI flags
2. Project config (.terminus.yaml)
3. Global app config (~/.terminus/config.yaml)
4. Built-in defaults

Deterministic merge behavior:
- scalar: override langsung.
- object: deep merge by key.
- list: replace penuh kecuali field bertipe append_list.

---

## 4. Global App Config Schema

```yaml
version: 1
app:
  telemetry:
    enabled: false
  theme: "system" # system|light|dark
  language: "id"
  default_profile: "balanced"
  startup:
    restore_last_session: true
    restore_tabs: true

ai:
  default_provider: "openai"
  default_model: "gpt-4.1-mini"
  routing_policy: "hybrid" # cheapest|fastest|highest-quality|hybrid|round-robin
  fallback_chain:
    - "anthropic:claude-sonnet-4"
    - "google:gemini-2.5-pro"
    - "ollama:llama3.1"
  timeout_ms: 120000
  stream: true

cost:
  currency: "USD"
  monthly_limit: 100
  soft_alert_thresholds: [70, 90]
  dedup_window_seconds: 10
  cache:
    enabled: true
    backend: "sqlite" # sqlite|redis
    similarity_threshold: 0.95
    default_ttl_seconds: 86400
    max_in_memory_entries: 2000

token_optimization:
  mode: "balanced" # strict|balanced|max-quality
  preflight_enabled: true
  auto_prune: true
  rolling_window_turns: 12
  preserve_pinned_facts: true

mcp:
  discovery:
    enabled: true
    scan_paths:
      - "./.mcp"
  default_timeout_ms: 30000
  retry:
    max_attempts: 2
    backoff_ms: 600

skill:
  global_paths:
    - "~/.terminus/skills"
  registry:
    enabled: false
    source: "community"

git:
  default_mode: "read-only" # read-only|full
  providers:
    github:
      enabled: true
      auth_method: "pat" # pat|oauth-device
    gitlab:
      enabled: true
      base_url: "https://gitlab.example.com"
      auth_method: "pat"

platform:
  shell_override: "" # kosong = auto-detect (zsh/bash/pwsh/cmd)
  notification_backend: "os" # os|in-app|both
  keychain_backend: "auto" # auto|system|file-fallback
  open_external_browser: true

ui:
  layout:
    default_preset: "focus-coding"
    allow_free_resize: true
  density: "comfortable" # compact|comfortable|spacious
  explorer:
    show_hidden_files: false
    confirm_delete: true
  status_panel:
    show_token_estimate: true
    show_cost_estimate: true
  notifications:
    dnd_enabled: false
    toast_position: "bottom-right"
    auto_dismiss_info_ms: 4000
    auto_dismiss_warning_ms: 8000
  search:
    enabled: true
    index_hidden_files: false
    max_index_entries: 100000
  accessibility:
    high_contrast: false
    font_size_scale: 1.0
    focus_ring_visible: true
  keyboard_shortcuts:
    command_palette: "CmdOrCtrl+K"
    new_tab: "CmdOrCtrl+T"
    close_tab: "CmdOrCtrl+W"
    toggle_explorer: "CmdOrCtrl+B"
    new_ai_session: "CmdOrCtrl+N"
    cancel_run: "Escape"
    open_settings: "CmdOrCtrl+Comma"
    switch_project: "CmdOrCtrl+Shift+P"
    focus_terminal: "CmdOrCtrl+Backtick"

update:
  channel: "stable" # stable|beta|nightly
  check_on_startup: true
  check_interval_hours: 24
  auto_download: true
  notify_before_restart: true

monitoring:
  enabled: true
  retention_days: 30
  export:
    prometheus_enabled: true
    prometheus_bind: "127.0.0.1:9464"
    webhook_enabled: false
```

---

## 5. Project Config Schema

```yaml
version: 1
project:
  id: "fmr-main"
  name: "FMR"
  workspace_root: "."
  profile: "balanced"

providers:
  primary:
    provider: "openai"
    model: "gpt-4.1-mini"
  fallback_chain:
    - provider: "anthropic"
      model: "claude-sonnet-4"
    - provider: "ollama"
      model: "llama3.1"
  custom:
    - name: "internal-llm"
      type: "http"
      endpoint: "https://llm.internal.company/v1/chat/completions"
      auth_ref: "secret://providers/internal-llm/token"

budget:
  daily_limit: 10
  monthly_limit: 200
  hard_stop_on_limit: true
  soft_alert_thresholds: [70, 90]

token_optimization:
  mode: "strict"
  rolling_window_turns: 8
  pinned_facts:
    - "Project domain rules wajib dipertahankan"

sandbox:
  enforce_boundary: true
  allowed_external_paths: []
  cross_project_access:
    default: "deny" # deny|confirm|allow
    audit_required: true

permissions:
  git:
    mode: "read-only" # read-only|full
    allow_push_branches:
      - "feature/*"
  mcp:
    default: "confirm"
    tool_policies:
      - tool: "filesystem.write"
        mode: "confirm"
      - tool: "shell.exec"
        mode: "deny"
  skills:
    allowlist:
      - "refactor-safe"
      - "doc-sync"

git:
  remote:
    provider: "gitlab"
    base_url: "https://gitlab.custom.company"
    project_path: "group/repo"
  branch_policy:
    protected:
      - "main"
      - "release/*"

ui:
  layout_preset: "focus-monitoring"
  density: "comfortable"
  tabs:
    restore_on_start: true
    max_open_tabs: 20
  panels:
    explorer_width: 280
    inspector_height: 320
  notifications:
    dnd_enabled: false
    budget_alert_toast: true
    git_result_toast: true
    mcp_permission_toast: true
  keyboard_shortcuts:
    # project-level override (merge with global)
    new_ai_session: "CmdOrCtrl+Shift+N"

monitoring:
  tags:
    team: "ops"
    cost_center: "infra"
  alerts:
    budget_webhook: "secret://alerts/budget/webhook"
```

---

## 6. CLI Overrides

Contoh override saat runtime:

```bash
terminus ask "review this PR" \
  --provider anthropic \
  --model claude-sonnet-4 \
  --token-save balanced \
  --budget-limit 5 \
  --workspace ./project-a
```

Mapping:
- --provider -> providers.primary.provider
- --model -> providers.primary.model
- --token-save -> token_optimization.mode
- --budget-limit -> budget.daily_limit (runtime only)

---

## 7. Validation Rules

Hard validation:
- version wajib integer dan didukung.
- similarity_threshold harus antara 0.80 sampai 0.999.
- timeout_ms minimal 1000.
- daily_limit dan monthly_limit tidak boleh negatif.
- workspace_root harus canonical path yang valid.
- jika git.providers.gitlab.enabled=true maka base_url wajib valid URL.

Semantic validation:
- monthly_limit sebaiknya >= daily_limit.
- max_open_tabs dibatasi 1..100.
- soft_alert_thresholds harus urut menaik dan < 100.

Policy validation:
- sandbox.enforce_boundary=true wajib jika cross_project_access.default=allow.
- git.mode=full harus explicit (tidak boleh default implicit).

---

## 8. Secrets Handling

Jangan simpan raw token di YAML.
Gunakan secret reference:
- secret://providers/openai/api_key
- secret://providers/gitlab/pat
- secret://alerts/budget/webhook

Resolution flow:
1. Core baca auth_ref dari config.
2. Core resolve ke keychain item.
3. Nilai secret dimuat in-memory secara ephemeral.
4. Secret zeroized setelah request selesai.

---

## 9. Effective Settings Example

Hasil merge final yang dipakai runtime:

```yaml
effective:
  provider: "anthropic"
  model: "claude-sonnet-4"
  token_optimization_mode: "balanced"
  budget_daily_limit: 5
  git_mode: "read-only"
  mcp_default_policy: "confirm"
  layout_preset: "focus-monitoring"
```

---

## 10. Migration Strategy

version 1 -> version 2:
- gunakan migrator di core-config.
- setiap perubahan field wajib ada backward-compat adapter minimal 1 major version.
- config invalid tidak boleh crash app; fallback ke safe defaults + warning.

---

## 11. Minimal Defaults (No Config Case)

Jika tidak ada config file:
- provider default: openai
- routing policy: hybrid
- token mode: balanced
- git mode: read-only
- mcp policy: confirm
- boundary enforcement: true
- ui preset: focus-coding
- density: comfortable
- dnd: false
- update channel: stable
- auto-download update: true
- high contrast: false
- font scale: 1.0

---

## Changelog

| Versi | Tanggal | Perubahan |
|-------|---------|----------|
| v1.0 | May 11, 2026 | Draft awal: global config + project config + secrets + validation + migration |
| v1.2 | May 11, 2026 | Tambah schema: density mode, notification (dnd/toast), search index, accessibility (high_contrast/font_scale/focus_ring), keyboard_shortcuts (global + project override), update (channel/check/auto-download); default values diperbarui |
| v1.3 | May 11, 2026 | Tambah schema: platform section (shell_override, notification_backend, keychain_backend, open_external_browser) untuk multi-OS support |

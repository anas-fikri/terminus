# Product Requirements Document v1.1
## AI Terminal Runtime + Cost Optimizer + DevOps Hub

**Status:** Draft v1.4  
**Last Updated:** May 11, 2026  
**Target MVP Release:** 8 weeks

---

## 1. Product Overview

**Name:** `terminus` (working title)  
**Vision:** Universal AI runtime yang mengubah terminal menjadi orchestration engine untuk AI models dengan fokus pada cost optimization, observability, dan extensibility via MCP + Skills.

**Positioning:**
- Bukan sekadar CLI wrapper AI—tapi infrastructure layer untuk dev workflow AI-native.
- Menyatukan: model gateway, cost control, token optimization, monitoring, extensibility.
- Core differentiator: provider-agnostic + optimization by default + observable by design.

---

## 2. User Personas

### 2.1 Dev Cost-Conscious (Primary)
- **Who:** Dev/startup yang pakai LLM API tapi concern dengan bill.
- **Pain Points:** Request redundan, token waste, no budget visibility.
- **Apa yang dia mau:** Auto cache, smart fallback, per-project cost tracking.

### 2.2 DevOps + ML Infra
- **Who:** Engineer yang manage LLM pipelines multi-model, multi-env.
- **Pain Points:** Sulit switch provider, provider downtime ga ada fallback, no unified observability.
- **Apa yang dia mau:** Provider abstraction, health check, SLA monitoring, audit trail.

### 2.3 LLM Research + Tinkerer
- **Who:** Eksperimen model lokal (ollama/lmstudio) + public API.
- **Pain Points:** Model switching ribet, ga ada benchmarking tools, config scattered.
- **Apa yang dia mau:** Unified interface, model registry, performance metrics per model.

### 2.4 Enterprise Automation
- **Who:** Company yang integrate AI ke existing dev tools + workflow.
- **Pain Points:** Ga bisa extend tool dengan MCP, skill ga reusable, biaya opacity.
- **Apa yang dia mau:** MCP integration, skill marketplace, cost allocation, compliance log.

---

## 3. Core Features

### 3.1 Universal Model Gateway
**What:** Provider-agnostic interface untuk akses semua model.

**Requirements:**
- **Adapter Pattern:**
  - Kontrak unified: `inference(model, messages, config) -> response`
  - Native adapter: OpenAI, Anthropic, Google, Ollama, LM Studio, custom HTTP.
  - Config per provider: auth method, endpoint, headers, version.

- **Model Registry:**
  - Metadata: provider, model ID, context window, input/output price, latency SLA, quality score.
  - Auto-detection capabilities (function calling, vision, streaming).
  - User can contribute model definition via YAML.

- **Custom Provider SDK:**
  - HTTP mode: user provide endpoint + auth → auto-wrapping.
  - Command mode: LM Studio/Ollama local integration.
  - Auth flexibility: API key, OAuth, signed token, mTLS.

- **Smart Routing:**
  - Policy: cheapest, fastest, highest-quality, hybrid (cost+latency), round-robin.
  - Per-request override via flag `--model-policy`.

**Acceptance Criteria:**
- [ ] Switch model in 1 flag: `ask "query" --model gpt-4 --provider openai`.
- [ ] Fallback chain works: `--fallback claude-3,gemini-pro,local-ollama`.
- [ ] Custom provider: user bikin endpoint, terminus auto-talk tanpa code.
- [ ] Latency + cost per model tercatat untuk routing decision.

---

### 3.2 Cost Proxy Layer (Cliproxy-like)
**What:** Intelligent request/response cache + budget guard + smart fallback.

**Requirements:**
- **Semantic Cache:**
  - Request fingerprint by embedding (bukan exact string).
  - Threshold similarity: 95% consider as duplicate.
  - Cache TTL policy: global default, per-model, per-project override.
  - Storage: SQLite atau Redis option.

- **Request Deduplication:**
  - In-flight dedup: same request dalam 10 detik → wait for first result.
  - Dedup scope: per-workspace, per-user, global (configurable).

- **Budget Guard:**
  - Hard limit per day/month/project.
  - Soft alert: 70%, 90% threshold notify user.
  - Auto-throttle mode: request queue, prioritize by importance (urgent flag).
  - Per-provider budget split.

- **Fallback Chain:**
  - Primary provider fail → automatic fallback ke model murah/backup.
  - Fallback cost vs quality tradeoff configurable.
  - Audit: log siapa + kapan fallback terjadi.

**Acceptance Criteria:**
- [ ] Duplicate request: detect & serve cache dalam < 50ms.
- [ ] Budget alert: user notified sebelum exceed limit.
- [ ] Fallback chain: primary fail → secondary auto-invoke within 2s.
- [ ] Cost report: breakdown per provider, per day, per project.

---

### 3.3 Token Optimization Engine (RTK-like)
**What:** Otomatis compress context, optimize prompt, minimize token usage.

**Requirements:**
- **Token Preflight:**
  - Estimasi token count sebelum request dikirim.
  - Warn jika akan exceed model context window atau budget.
  - User can accept/adjust/cancel sebelum actual inference.

- **Context Compaction:**
  - Level 0: no compress (full context).
  - Level 1: remove redundant lines + collapse whitespace.
  - Level 2: summarize old messages (keep recent full, old summarized).
  - Level 3: semantic deduplicate facts + retrieve on demand.
  - User select mode: `--token-save strict|balanced|max-quality`.

- **Prompt Pruning:**
  - Auto-detect irrelevant context (similarity score < threshold).
  - Suggest removal, user confirm atau force full context.
  - Keep pin-important facts (user mark dengan `#PIN`).

- **Rolling Memory Window:**
  - Conversation history: keep last N turns full, older turns summarized.
  - Configurable N per session.

- **Cost Estimation:**
  - Show projected cost before run: `Estimated: $0.05 (could be $0.02 if compress)`.
  - Per-request cost tracking + actual vs estimate comparison.

**Acceptance Criteria:**
- [ ] Preflight estimate accuracy: ±5% actual tokens.
- [ ] Token save strict mode: reduce tokens 40-60% vs full context.
- [ ] User PIN facts: pinned facts tidak di-compress.
- [ ] Cost transparency: user lihat before/after + projected savings.

---

### 3.4 CLI Interface
**What:** Command-line first-class experience, multi-mode workflow.

**Requirements:**
- **Quick Ask Mode:**
  ```
  ask "What is Rust ownership?" --model gpt-4 --output json
  ```

- **Interactive REPL:**
  ```
  terminus
  > ask "explain closure"
  > refine "more concise"
  > code "show Rust example"
  > cost
  > exit
  ```

- **Config Management:**
  - Global: `~/.terminus/config.yaml`
  - Project: `.terminus.yaml` (git-tracked).
  - Per-command override: `--provider openai --budget-limit 100`.
  - Profile support: dev, prod, research.

- **Multi-Project:**
  - Workspace structure: `--workspace myproject` atau current folder auto-detect.
  - Per-project cost tracking + provider config.

- **Batch Mode:**
  ```
  ask @questions.txt --output markdown --batch-size 5 --delay 2s
  ```

- **Output Formats:**
  - `text`, `markdown`, `json`, `csv`, `html`.
  - Save to file: `--output file.md`.
  - Pipe-friendly.

**Acceptance Criteria:**
- [ ] `ask` command works in < 2s cold start.
- [ ] REPL persistent session, cost tracking across commands.
- [ ] Config merge: CLI flag > project config > global config.
- [ ] Batch mode: process 100 questions within budget/SLA.

---

### 3.5 Browser Inspector (Lightweight)
**What:** Minimal web UI untuk debugging + element inspection tanpa full Playwright UX.

**Requirements:**
- **Modes:**
  - Headless mode: `inspect-page <url>` → screenshot + DOM JSON.
  - Interactive mode: simple UI, navigate page, select element, extract text.
  - Session mode: snapshot DOM + prompt context buat AI analyze.

- **Element Extraction:**
  - CSS selector input → extract text, attributes, HTML.
  - Visual highlight pada page.
  - Batch extract: loop selectors, output JSON.

- **Screenshot + OCR:**
  - Screenshot on demand.
  - Optional OCR untuk text detection.

- **Session Artifacts:**
  - Save DOM snapshot + URL + screenshot + prompt → reproducible.
  - Linked ke AI response buat traceability.

- **Constraints:**
  - Lightweight: no heavy render engine required.
  - Composable: bisa integrate ke CLI workflow.

**Acceptance Criteria:**
- [ ] Inspect page load < 3s.
- [ ] Extract element via selector works reliably.
- [ ] Session artifact: reproducible selain timestamp-dependent content.

---

### 3.6 Monitoring Engine
**What:** Observability layer untuk cost, health, performance, audit.

**Requirements:**
- **Cost Metrics (Real-time Dashboard):**
  - Daily spend vs budget visualization.
  - Per-provider breakdown: API calls, tokens, cost.
  - Per-project allocation: which project spend most.
  - Trend: daily, weekly, monthly.
  - Alert: threshold breach, unusual spike.

- **Health Monitoring:**
  - Provider status: online/degraded/offline.
  - Response latency per provider (p50, p99).
  - Error rate: 4xx, 5xx, timeout.
  - Fallback activation log: when + why.

- **Performance Metrics:**
  - Token efficiency: actual tokens vs estimated.
  - Cache hit ratio per semantic bucket.
  - Dedup rate: % request dari cache/dedup.
  - Model quality score: user satisfaction rating per model (thumbs up/down).

- **Audit Trail:**
  - Every inference: timestamp, provider, model, tokens, cost, user, workspace, result status.
  - Every fallback: from → to, reason, cost delta.
  - Config changes: when + who.
  - Sensitive: log at DEBUG level, not default.

- **Export + Integration:**
  - Metrics export: JSON, Prometheus format, CSV.
  - Webhook: cost alert, fallback event, budget warning.
  - Grafana integration ready (prometheus scrape endpoint).

**Acceptance Criteria:**
- [ ] Dashboard load < 1s, real-time updates.
- [ ] Cost data accuracy: match provider invoice ±2%.
- [ ] Audit trail: searchable by date, provider, user, model, status.
- [ ] Alert triggered before budget exceed.

---

### 3.7 MCP Integration
**What:** Model Context Protocol support untuk tool discovery + orchestration.

**Requirements:**
- **MCP Tool Discovery:**
  - Auto-discover MCP servers dari workspace.
  - Tool registry: name, description, input schema, output schema.
  - Health check MCP before use.

- **Tool Invocation:**
  - Within conversation: `@toolname arg1 arg2` trigger MCP call.
  - Async tool + streaming result.
  - Tool result injected back to LLM context.

- **Permission Boundary:**
  - Per-workspace permission policy.
  - Allow/Deny/ConfirmOnUse per tool.
  - No tool call tanpa user ack (unless auto-approve configured).

- **Cost Tagging:**
  - MCP tool call cost (estimated, user provide metadata).
  - Budget accounting: include tool call cost.
  - MCP tool latency + cost logged.

- **Error Handling:**
  - Tool fail → fallback to alternative atau skip.
  - Timeout policy: default 30s, configurable.
  - Retry logic: exponential backoff.

**Acceptance Criteria:**
- [ ] MCP tool invoke dalam < 5s (with network latency).
- [ ] Permission: user confirm tool call before execution (default mode).
- [ ] Error: tool fail tidak crash terminus, graceful degradation.
- [ ] Cost: tool call included dalam budget accounting.

---

### 3.8 Skill System
**What:** Reusable AI automation workflows packaged as skills.

**Requirements:**
- **Skill Packaging:**
  - Skill = YAML config + prompt template + tool dependency.
  - Scope: project skill (local), global skill (~/.terminus/skills), community skill (registry).
  - Persona skill: role-specific prompt template + tool set.

- **Skill Invocation:**
  ```
  skill run refactor --file src/main.ts --target-style prettier
  skill list
  skill search "optimization"
  skill install community:rust-analyzer-skill
  ```

- **Skill Composition:**
  - Skill dapat call skill lain.
  - Flow control: sequential, parallel, conditional.
  - Input/output contract per skill.

- **Skill Registry (Future):**
  - Community marketplace (gated, security scanned).
  - Version management.
  - Dependency resolution.

**Acceptance Criteria:**
- [ ] Project skill: persist dalam `.terminus/skills/`.
- [ ] Skill invoke: `skill run <skill-name>` works offline.
- [ ] Skill composition: skill A can call skill B successfully.

---

### 3.9 Desktop Workspace UX + Git Integration
**What:** Desktop app shell yang stabil, fleksibel, dan aman untuk multi-project workflow.

**Requirements:**
- **Multi-Project Isolation Boundary:**
  - Tiap project punya sandbox sendiri: session state, cache namespace, budget namespace, skill namespace.
  - Hard boundary by workspace root: no cross-project read/write by default.
  - Permission bridge untuk cross-project action harus explicit user approval.
  - Secrets scope per project (token provider, webhook, MCP secret) terenkripsi dan tidak saling bocor.

- **Multi-Tab + Split Workspace:**
  - Support multi-tab terminal/AI session per project.
  - Tab restore on restart.
  - Split panes horizontal/vertical untuk lihat beberapa context sekaligus.

- **Tree Explorer + File Ops:**
  - Left explorer panel: folder tree, search file, open file.
  - Context actions: rename, create file/folder, delete (with confirmation policy).
  - Explorer terikat boundary project aktif.

- **Flexible Resizable Layout:**
  - Semua area bisa di-drag resize: sidebar, terminal panel, output panel, inspector panel.
  - Layout preset: Focus Coding, Focus Monitoring, Focus Inspect.
  - Persist layout per-project.

- **GitHub + Custom GitLab Connectivity:**
  - Native auth GitHub (PAT/OAuth device flow).
  - GitLab configurable (self-host/custom domain + PAT).
  - Basic workflows: clone, fetch, pull, push, branch checkout, MR/PR metadata read.
  - Repo provider setting bisa beda per project.

- **AI Activity States (UX Feedback):**
  - State wajib terlihat jelas: `loading`, `working`, `thinking`, `tool-calling`, `streaming`, `done`, `error`.
  - Ada elapsed timer + cancellable action.
  - Status panel menampilkan provider/model + estimated token/cost saat request jalan.

- **Settings Model (Global + Project):**
  - Global app setting: theme, default provider, telemetry, default budget policy.
  - Project setting: provider routing, budget limit, MCP allowlist, skill allowlist, layout preset.
  - Precedence rule: CLI flag > project setting > app setting > default.

**Acceptance Criteria:**
- [ ] Data/caches/secrets antar project terisolasi dan tidak tercampur.
- [ ] User dapat buka minimal 10 tab aktif tanpa crash.
- [ ] Tree explorer hanya mengakses root project aktif kecuali izin eksplisit.
- [ ] Semua panel utama bisa resize via drag dan persist setelah restart.
- [ ] GitHub + custom GitLab bisa connect dan fetch repo metadata.
- [ ] Semua AI states tampil real-time dengan cancel action yang berfungsi.
- [ ] Setting app + project tersimpan, precedence rule konsisten.

---

---

### 3.10 Global Search
**What:** Search lintas konten dalam satu keystroke dari mana pun di aplikasi.

**Requirements:**
- **Search Scope:**
  - File + folder dalam project aktif.
  - History session/conversation dalam project.
  - Skill yang tersedia (global + project).
  - MCP tools yang terdaftar.
  - Setting key (app + project).
  - Command palette: semua aksi yang bisa dilakukan user.

- **UX Pattern:**
  - Trigger: `Cmd+K` / `Ctrl+K` → floating overlay muncul di tengah.
  - Fuzzy search dengan highlight karakter matching.
  - Navigasi hasil dengan keyboard (arrow + enter).
  - Kontekstual: dalam explorer → prioritaskan file; dalam AI session → prioritaskan history.

- **Search Index:**
  - Index dibangun saat project dibuka, update incremental saat file berubah.
  - Index disimpan lokal per project.
  - Tidak kirim konten ke server.

**Acceptance Criteria:**
- [ ] Search overlay muncul < 100ms setelah trigger.
- [ ] File ditemukan dalam project dengan fuzzy match.
- [ ] Command palette menampilkan semua aksi yang relevan.
- [ ] Keyboard-navigable penuh tanpa mouse.

---

### 3.11 Notification + Toast System
**What:** Sistem notifikasi in-app yang informatif tapi tidak mengganggu.

**Requirements:**
- **Toast Notification:**
  - Posisi: pojok kanan bawah, stack vertikal.
  - Level: info, success, warning, error.
  - Auto-dismiss: info/success 4s, warning 8s, error persisten sampai dismiss.
  - Click-to-expand untuk detail error lengkap.

- **Notification Center:**
  - Bell icon di header dengan badge count unread.
  - Riwayat notifikasi: budget alert, fallback event, MCP permission request, git op result.
  - Mark as read / clear all.
  - Filter by category.

- **Silent Notification:**
  - Background event (cache eviction, health check, soak warning) hanya masuk notification center, tidak toast.
  - User bisa set DND mode: semua toast disuppress kecuali error kritis.

**Acceptance Criteria:**
- [ ] Toast muncul < 200ms dari event.
- [ ] Error toast tidak auto-dismiss, ada tombol detail.
- [ ] Notification center searchable dan filterable.
- [ ] DND mode aktif: hanya error kritis yang toast.

---

### 3.12 UX Design Principles
**What:** Panduan desain yang menjamin clean UI + information-complete + mudah digunakan.

**Prinsip Utama:**

1. **Progressive Disclosure**
   - Default tampilan: hanya info yang dibutuhkan untuk task saat ini.
   - Detail/advanced tersedia dengan 1 klik/expand, bukan default terlihat.
   - Contoh: cost estimate tampil ringkas, klik untuk breakdown detail.

2. **Information-Complete tanpa Overwhelm**
   - Semua data penting visible dalam 1 view tanpa scroll jika bisa.
   - Gunakan density mode: compact (default), comfortable, spacious.
   - AI state indicator: always visible di status bar, bukan hanya di panel besar.

3. **Keyboard-First, Mouse-Optional**
   - Semua aksi utama punya keyboard shortcut.
   - Tab-navigable seluruh UI.
   - Command palette (`Cmd+K`) sebagai universal entrypoint.

4. **Consistent Visual Feedback**
   - Semua aksi yang membutuhkan waktu > 100ms menampilkan loading state.
   - Aksi destructive selalu membutuhkan confirmation.
   - Sukses + error selalu ada visual feedback (toast/banner).

5. **Context Awareness**
   - UI menyesuaikan project aktif: nama project visible di header.
   - Tab aktif dan state tidak hilang saat switch project.
   - Error message harus actionable: jelaskan apa yang salah + apa yang bisa dilakukan.

6. **Clean Visual Hierarchy**
   - Maksimal 3 level heading dalam satu view.
   - Warna fungsional: info=biru, success=hijau, warning=kuning, error=merah. Konsisten.
   - Font size hierarchy: primary content >= 14px, secondary >= 12px, caption >= 11px.

7. **Accessibility (a11y)**
   - WCAG 2.1 AA minimum sebagai target.
   - Contrast ratio: minimal 4.5:1 untuk teks normal.
   - Semua interactive element punya aria-label.
   - Screen reader support (basic): role + label.
   - Focus ring visible untuk keyboard navigasi.

**Keyboard Shortcuts (Core):**

| Aksi | macOS | Windows/Linux |
|------|-------|---------------|
| Command palette | Cmd+K | Ctrl+K |
| New tab | Cmd+T | Ctrl+T |
| Close tab | Cmd+W | Ctrl+W |
| Switch tab | Cmd+1..9 | Ctrl+1..9 |
| Toggle explorer | Cmd+B | Ctrl+B |
| New AI session | Cmd+N | Ctrl+N |
| Cancel AI run | Escape | Escape |
| Focus terminal | Cmd+` | Ctrl+` |
| Open settings | Cmd+, | Ctrl+, |
| Global search | Cmd+K | Ctrl+K |
| Switch project | Cmd+Shift+P | Ctrl+Shift+P |

**Acceptance Criteria:**
- [ ] Semua shortcut core bekerja tanpa konflik.
- [ ] Seluruh UI navigable dengan keyboard saja.
- [ ] Contrast ratio ≥ 4.5:1 untuk semua teks normal.
- [ ] Loading state muncul untuk semua operasi > 100ms.
- [ ] Error message selalu ada actionable suggestion.

---

### 3.13 Onboarding + First-Run Experience
**What:** Experience hari pertama yang smooth tanpa butuh baca dokumentasi.

**Requirements:**
- **Welcome Flow (one-time):**
  - Step 1: Pilih bahasa UI.
  - Step 2: Connect provider pertama (OpenAI / Anthropic / Ollama / Custom) dengan guided wizard.
  - Step 3: Set budget awal (atau skip).
  - Step 4: Import project pertama atau buat baru.
  - Step 5: Quick tour overlay: highlight 5 area utama UI.

- **Empty State Design:**
  - Tiap area punya empty state yang informatif: apa fungsinya + aksi untuk mulai.
  - Contoh: tab AI session kosong → "Mulai tanya AI. Tekan Cmd+N atau ketik di bawah."

- **Provider Setup Wizard:**
  - Detect local Ollama/LM Studio otomatis.
  - Test connection sebelum save.
  - Tampilkan estimated cost per model sebagai referensi.

- **Recovery State:**
  - Jika provider fail setelah setup: bantu user troubleshoot dengan checklist.
  - Jika config corrupt: reset ke default dengan backup otomatis config lama.

**Acceptance Criteria:**
- [ ] First-run: user bisa kirim request AI pertama dalam < 3 menit.
- [ ] Empty state: setiap area punya konten helper yang actionable.
- [ ] Provider wizard: connection test berhasil sebelum save.
- [ ] Config corrupt: fallback ke default tanpa data loss.

---

### 3.14 Auto-Update Mechanism
**What:** Aplikasi update otomatis atau semi-otomatis dengan aman.

**Requirements:**
- **Update Check:**
  - Cek update saat startup + setiap 24 jam.
  - Tampilkan badge di menu jika ada update baru.

- **Update Flow:**
  - Download di background.
  - Notify user saat siap install: "Update tersedia, restart untuk apply."
  - User bisa defer atau install sekarang.

- **Release Channels:**
  - stable (default), beta, nightly.
  - User bisa pilih channel di app settings.

- **Rollback:**
  - Simpan 1 versi sebelumnya untuk rollback jika crash post-update.

**Acceptance Criteria:**
- [ ] Update check tidak memblok startup.
- [ ] User tidak dipaksa update.
- [ ] Rollback tersedia jika update bermasalah.

---

## 4. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│          Desktop Shell (Multi-Tab, Explorer, Split Layout)         │
│                    + CLI/REPL/Web Inspector                         │
└────────────┬────────────────────────────┬───────────────────────────┘
        │                            │
      ┌──────▼──────┐          ┌──────────▼─────────────┐
      │ Command     │          │ Layout + UI State      │
      │ Parser      │          │ Manager (Resizable)    │
      └──────┬──────┘          └──────────┬─────────────┘
             │
      ┌──────▼──────────────────────────────────────────────────────┐
      │ Session + Config Manager (global/project/profile/mode)     │
      └──────┬───────────────────────────────┬─────────────────────┘
        │                               │
      ┌──────▼──────────────┐        ┌───────▼───────────────────┐
      │ Project Sandbox      │        │ Git Connector             │
      │ (boundary + secrets) │        │ (GitHub + custom GitLab) │
      └──────┬───────────────┘        └───────────────────────────┘
             │
      ┌──────▼────────────────────────────────────────┐
      │          Request Pipeline                     │
      │ ┌─────────────────────────────────────────┐   │
      │ │ 1. Token Preflight (estimate cost)      │   │
      │ │ 2. Cache Lookup (semantic + dedup)      │   │
      │ │ 3. Budget Check (hard limit)            │   │
      │ │ 4. Model Selection (routing policy)     │   │
      │ │ 5. MCP Tool Inject (if needed)          │   │
      │ │ 6. Prompt Optimization (compress)       │   │
      │ │ 7. Inference Call (with fallback chain) │   │
      │ │ 8. Response Cache (semantic store)      │   │
      │ │ 9. Monitoring Record (cost, latency)    │   │
      │ │ 10. Format Output (text/json/etc)       │   │
      │ └─────────────────────────────────────────┘   │
      └────────┬──────────────────────┬───────────────┘
               │                      │
      ┌────────▼─────┐       ┌────────▼──────────┐
      │ Model        │       │  Cost Proxy       │
      │ Gateway      │       │  + Optimizer      │
      │ (Adapters)   │       │  + Cache Store    │
      └────────┬─────┘       └────────┬──────────┘
               │                      │
      ┌────────▼───────────────────────▼──────┐
      │     Monitoring + Audit Engine         │
      │ (metrics, alerts, logs, export)       │
      └──────────────────────────────────────┘
```

**Key Modules:**
1. **Desktop Shell + CLI/UX Layer:** Multi-tab, explorer, split layout, command parser, REPL.
2. **Session + Config Manager:** Global/project settings, profile merge, workspace awareness.
3. **Project Sandbox Manager:** Data boundary, per-project secret isolation, permission bridge.
4. **Request Pipeline:** Orchestrate 10-step inference flow.
5. **Model Gateway:** Adapter pattern untuk berbagai provider.
6. **Cost Engine:** Cache, dedup, budget guard, token optimization.
7. **Monitoring:** Metrics collection, export, alerting.
8. **MCP + Skill Runtime:** Tool discovery, execution, composition.
9. **Git Connector:** GitHub + GitLab custom integration.

---

## 5. MVP Scope (8 Weeks)

### Phase 1: Foundation (Week 1-2)
- **CLI core:** ask, refine, code, cost command.
- **Model Gateway:** OpenAI adapter (gpt-4, gpt-3.5-turbo), Anthropic adapter.
- **Config:** global + project YAML, profile support.
- **Session:** basic state persistence (JSON).
- **Project Sandbox:** per-project boundary + scoped secrets.

**Deliverable:** `terminus ask "hello" --model gpt-4` works end-to-end.

### Phase 2: Cost Control (Week 3-4)
- **Semantic Cache:** SQLite-based, 95% similarity threshold.
- **Budget Guard:** per-project limit + alert.
- **Token Preflight:** estimate accuracy ±5%.
- **Cost Report:** daily breakdown.

**Deliverable:** `ask --token-save balanced` reduce tokens visibly + cost report accurate.

### Phase 3: Extensibility (Week 5-6)
- **MCP Integration:** tool discovery + safe invocation.
- **Skill System:** project skill + basic composition.
- **Custom Provider:** HTTP endpoint mode.
- **Fallback Chain:** provider fail → auto fallback.

**Deliverable:** Skill invoke works, MCP tool call works, fallback tested.

### Phase 4: Monitoring + Polish (Week 7-8)
- **Monitoring Engine:** real-time cost dashboard, audit trail.
- **Browser Inspector:** lightweight DOM inspect + screenshot.
- **REPL:** full interactive session.
- **Desktop Shell:** multi-tab, tree explorer, resizable split panels, AI activity states.
- **Git Connector:** GitHub + custom GitLab support.
- **Performance:** latency < 2s per ask, cache hit tracking.
- **Docs + Tests:** README, CLI help, unit tests.

**Deliverable:** `terminus` production-ready MVP, monitoring visible.

---

## 6. Success Metrics

### Business Metrics
- [ ] Dev dapat save 30-50% biaya via optimization + caching.
- [ ] User dapat switch provider dalam 1 command.
- [ ] Community contribute 5+ custom skills dalam 3 bulan post-MVP.

### Technical Metrics
- [ ] CLI latency: < 2s ask command (cold start).
- [ ] Cache hit rate: > 20% typical workload.
- [ ] Token save: 40-60% dalam strict mode, < 5% quality loss.
- [ ] Provider fallback: < 3s to successful alternative.
- [ ] Monitoring uptime: 99.9%.
- [ ] Test coverage: > 70% code coverage.

### User Metrics
- [ ] NPS > 50 dari early adopters.
- [ ] 80% user retention setelah 1 bulan.
- [ ] GitHub stars: > 200 dalam 6 bulan.

---

## 7. Technical Constraints & Considerations

**Tech Stack (Proposed):**
- **Core Runtime Language:** Rust (stabil, memory-safe, minim memory leak risk by design).
- **Desktop UI Language:** TypeScript (dinamis untuk UI/plugin layer) + Tauri shell.
- **Interop:** Rust core exposed via typed IPC boundary ke UI.
- **Storage:** SQLite (cache + audit) + Redis option (distributed).
- **Config:** YAML (human-friendly, git-trackable).
- **Monitoring:** Prometheus metrics + Grafana dashboard.
- **Testing:** Rust unit/integration tests + Playwright/E2E UI tests.

**Multi-OS Support:**
- Target platform: macOS (arm64 + x86_64), Windows 10+ (x86_64), Linux (x86_64 + arm64, AppImage + .deb).
- Tauri + Rust compile ke native binary per OS dari satu codebase.
- Tidak butuh runtime tambahan (bukan Electron, bukan JVM).
- OS-specific handling wajib:
  - **Keychain:** macOS Keychain, Windows Credential Manager, Linux libsecret/kwallet.
  - **Paths:** platform-aware path resolver (config dir, data dir, cache dir).
  - **Keyboard shortcuts:** `Cmd` di macOS → `Ctrl` di Windows/Linux.
  - **Notifications:** macOS Notification Center, Windows Toast, Linux libnotify.
  - **Auto-update:** signed DMG (macOS), NSIS installer (Windows), AppImage (Linux).
  - **Shell default:** zsh/bash (macOS/Linux), PowerShell/cmd (Windows).
  - **File permission model:** POSIX (macOS/Linux) vs Windows ACL.
- CI/CD matrix: build + test di semua 3 OS.

**Risks:**
1. **Provider API Variance:** Setiap provider beda format function-calling. → Mitigation: adapter pattern + comprehensive test matrix.
2. **Token Optimization vs Quality:** Over-compress context bisa bikin response jelek. → Mitigation: quality scoring + user mode selection.
3. **MCP Security:** Tool bisa sensitive (file write, execute). → Mitigation: permission boundary + audit log + no auto-run default.
4. **Semantic Cache Accuracy:** False positive cache hit berbahaya. → Mitigation: lower threshold (95%+), human review mode.
5. **Scaling:** Monitoring + cache storage bisa bottleneck. → Mitigation: async collection, batch storage.
6. **UI Complexity:** Multi-tab + resizable panels rawan state bug. → Mitigation: centralized layout state + snapshot restore tests.
7. **Git Provider Auth Drift:** OAuth/PAT flow bisa berubah. → Mitigation: provider-specific auth adapter + integration tests.
8. **Cross-OS Divergence:** Behavior beda tiap OS (keychain, path, shortcut). → Mitigation: platform abstraction layer di Rust, CI matrix 3 OS.

**Non-Functional Requirements:**
- **Performance:** Ask command < 2s cold, < 500ms warm.
- **Availability:** CLI offline-capable (fallback to local model).
- **Security:** No API key log, encrypted storage, audit trail.
- **Scalability:** Support 1000+ daily ask per single user, multi-workspace.
- **Memory Safety:** Long-running runtime tidak menunjukkan growth memory tidak wajar; soak test 24h stabil.

---

## 8. MVP Roadmap (Detailed)

| Week | Focus | Key Deliverable |
|------|-------|-----------------|
| 1-2  | Foundation: CLI core + OpenAI adapter | `ask` command works end-to-end |
| 3-4  | Cost Control: cache + budget + preflight | 30%+ token reduction validated |
| 5-6  | Extensibility: MCP + skill + fallback | MCP tool invoke + skill run works |
| 7-8  | Monitoring + Polish + Docs | Dashboard visible, CLI help comprehensive |
| Post-MVP | Expand: more adapters, community skills, marketplace | Scale adoption |

---

## 9. Final Decisions & Next Steps

1. **Semantic Cache Engine:** local-simhash default (hemat biaya, offline-friendly), optional upgrade ke local embedding di phase berikutnya.
2. **Monitoring Retention:** 30 hari detail logs (hot), lanjutkan agregasi periodik untuk data historis.
3. **MCP Permissions:** default `confirm` (safe by default, tetap usable).
4. **Community Skills Governance:** signed manifest + curated registry + semver policy.
5. **Git Scope Policy:** default read-only, write operation perlu explicit enable per project.

**Next Actions:**
- [ ] Refinement feedback dari stakeholder (you).
- [x] Architecture deep-dive document (module boundary, API contract).
- [x] Proto config schema `.terminus.yaml`.
- [ ] Tech spike: semantic cache accuracy with different embed models.
- [x] Setup dev environment + project structure.

---

## 10. Execution Artifacts

- Architecture Deep-Dive v1: `ARCHITECTURE_v1.md`
- Config Schema v1: `CONFIG_SCHEMA_v1.md`

---

**Questions untuk diskusi lanjutan:**
- Setuju MVP timeline 8 minggu?
- Priority: cost saving atau extensibility dulu?

---

## Changelog

| Versi | Tanggal | Perubahan |
|-------|---------|-----------|
| v1.0 | May 11, 2026 | Draft awal: 8 core features, arsitektur dasar |
| v1.1 | May 11, 2026 | Tambah: multi-project boundary, multi-tab, explorer, layout fleksibel, GitHub/GitLab, AI states, settings global+project, Rust+Tauri stack decision |
| v1.2 | May 11, 2026 | Tambah: Global Search (3.10), Notification System (3.11), UX Design Principles (3.12) termasuk keyboard shortcuts + a11y, Onboarding first-run (3.13), Auto-Update Mechanism (3.14); format changelog di bawah |
| v1.3 | May 11, 2026 | Tambah: Multi-OS Support (macOS/Windows/Linux) di Tech Stack, risk #8 cross-OS divergence, CI matrix 3 OS |
| v1.4 | May 11, 2026 | Keputusan final 5 area dibakukan: semantic cache local-simhash, retention 30 hari, MCP confirm, skill governance signed+curated, Git default read-only; status setup project ditandai selesai |


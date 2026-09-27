# OmOswitch: Profile Switcher for OmO Native (from scratch) — Implementation Plan

## Context

**Request.** Build OmOswitch from scratch, not as a fork. It is "CC Switch for OmO Native" (`omo 5.0.1`, engine senpi). It is a Windows 11 desktop app for keeping named model-assignment profiles (agents and categories) and switching between them. A switch writes the selected profile into the `"[native]"` block of `%USERPROFILE%\.omo\omo.jsonc`. The edit keeps all comments and other content, is atomic, and makes a backup first. Native hot-reloads the file, so the change takes effect without a restart. The UI is Japanese by default, with English as the second language. Keep it lean, around 3–4k LOC.

**Verified facts (from the notepad and the brief):**
- **Layering.** Native reads base keys, then `[senpi]` (legacy), then `[native]`, then `profiles.<name>`, then `profiles.<name>[native]`. `[opencode]` is not applied to native. The user's file currently has agents and categories only under `[opencode]`, so native gets none of them. This is the gap OmOswitch fills.
- **Hot reload and backups.** Native hot-reloads `omo.jsonc`. OmO's own backups are named `omo.jsonc.bak.<ISO>`.
- **Model list.** `omo --list-models` prints a table with columns `provider model context max-out thinking images`.
- **Secrets.** Never read or display `~/.omo/agent/auth.json` or `~/.config/opencode/opencode.json`.
- **Reference.** CC Switch `omo.rs` (MIT, @1ee2fdc) supplies the pattern: round-trip edit, reparse-verify, a changed-on-disk guard and atomic write (Windows `ReplaceFileW`).

**Design decisions:**
1. **Write mode: only `[native]` agents and categories. No `OMO_PROFILE` or `profiles` mode.**
   - `OMO_PROFILE` is read when a process starts. A tray switch can't change the environment of shells or sessions that are already running, so the user would have to relaunch. Writing `[native]` takes effect at once through config-watch.
   - The `profiles.<name>` mode would need users to manage the environment variable themselves. That undermines the "one-click switch" goal.
   - The `profiles` block can be added later without changing the store format.
2. **Ownership.** A profile owns exactly two subtrees: `[native].agents` and `[native].categories`.
   - Applying a profile replaces those two values wholesale.
   - All other keys and comments in `[native]`, and everywhere else in the file, stay byte-identical.
   - If `[native]` is missing, it is inserted after the `"[opencode]"` member, or as the last top-level member if `[opencode]` is absent.
3. **Editor: span-splice, not a full re-serialize.**
   - A small JSONC tokenizer finds the byte spans of the target values, and only those spans are replaced. Everything outside them is identical by construction.
   - The `json5` crate then parses the old and new text semantically. The write goes ahead only if `reparsed(new) == expected(old with the two subtrees replaced)`.
   - This keeps CC Switch's verify, guard and atomic-write approach but avoids re-formatting risk in the json-five round-trip API. Port attribution goes in `NOTICE`.
4. **Import from `[opencode]`.** Rename `metis` to `plan-consultant` and `momus` to `plan-reviewer`, because native uses the new names (verified). The UI shows a notice listing the renamed keys.
5. **Legacy `[senpi]`.** If a `[senpi]` block exists, show a warning. Its keys under agents or categories still merge underneath `[native]`. OmOswitch never edits `[senpi]`.
6. **Drift detection.**
   - "Drifted" means the semantic value of `[native].{agents, categories}` in the file differs from the active profile. The comparison uses canonical JSON (sorted keys).
   - Detection polls with `get_status` every 3 seconds while the window is visible, plus on window focus and when the tray menu opens. No `notify` dependency.
   - When drifted, the UI offers two actions: **Re-apply**, or **Capture into profile** (overwrite the active profile from the file).
7. **Out of scope:** proxy, failover, usage stats, cloud sync, MCP and skills management, other CLIs, and editing `settings.json`, `models.json` or `auth.json`.

## Environment overrides (every code path must honor them; QA must use them):

| Var | Default | Purpose |
|---|---|---|
| `OMOSWITCH_OMO_HOME` | `%USERPROFILE%\.omo` | Directory containing `omo.jsonc` |
| `OMOSWITCH_HOME` | `%USERPROFILE%\.omoswitch` | Store directory |
| `OMOSWITCH_OMO_BIN` | `omo` (resolved on PATH) | `omo` executable (lets tests use a fake, or a missing path) |

## Directory Tree (exact)

```
omoswitch/
├── .gitignore
├── NOTICE
├── README.md
├── package.json
├── pnpm-lock.yaml
├── index.html
├── vite.config.ts
├── tsconfig.json
├── playwright.config.ts
├── e2e/app.spec.ts
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   ├── i18n/{index.ts, ja.json, en.json}
│   ├── lib/
│   │   ├── types.ts
│   │   ├── api.ts
│   │   ├── mockIpc.ts
│   │   ├── catalog.ts
│   │   ├── assignment.ts
│   │   └── *.test.ts
│   └── components/
│       └── (Task 7 components)
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── capabilities/default.json
    ├── icons/
    └── src/
        ├── main.rs
        ├── lib.rs
        ├── error.rs
        ├── paths.rs
        ├── jsonc_edit.rs
        ├── store.rs
        ├── models.rs
        ├── omo_config.rs
        ├── commands.rs
        ├── tray.rs
        └── bin/omoswitch-cli.rs
```

## Pinned Dependencies

These are floor versions. Before scaffolding, the executor checks each one with context7 (or `pnpm view <pkg> version` / `cargo search <crate>`), then pins the exact latest patch of that major.minor. Exact versions (no `^`) go in `package.json`, exact `=x.y.z` in `Cargo.toml`.

**Frontend** (pin exact in `package.json`):
- Runtime: `react@18.3.1`, `react-dom@18.3.1`, `@tauri-apps/api@2.8.0`, `i18next@25.x`, `react-i18next@15.x`
- Dev: `@tauri-apps/cli@2.8.x`, `vite@7.x`, `@vitejs/plugin-react@5.x`, `typescript@5.9.x`, `tailwindcss@4.1.x`, `@tailwindcss/vite@4.1.x`, `vitest@3.2.x`, `jsdom@26.x`, `@testing-library/react@16.x`, `@playwright/test@1.5x.x`
- No Radix and no TanStack Query. A native `<select>` and a hand-made combobox are enough. Prefer subtraction.

**Rust** (`Cargo.toml`):
- `tauri = { version = "=2.8.x", features = ["tray-icon"] }`
- `tauri-build = "=2.4.x"`
- `tauri-plugin-single-instance = "=2.3.x"`
- `serde = { version = "=1.0.x", features = ["derive"] }`
- `serde_json = { version = "=1.0.x", features = ["preserve_order"] }`
- `json5 = "=0.4.1"`
- `thiserror = "=2.0.x"`
- `chrono = { version = "=0.4.x", default-features = false, features = ["clock"] }`
- `sha2 = "=0.10.x"`
- `uuid = { version = "=1.x", features = ["v4"] }`
- `windows-sys = { version = "=0.59.x", features = ["Win32_Storage_FileSystem", "Win32_Foundation"] }` (Windows target only)
- dev-dependency: `tempfile = "=3.x"`

## Tauri Command Contract

Commands use camelCase args and camelCase serde (`#[serde(rename_all = "camelCase")]`). Every command returns `Result<T, AppError>`.

```ts
type Reasoning = "off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"|"auto";
type Assignment = Record<string, unknown>;
interface Profile { id: string; name: string; note: string;
  agents: Record<string, Assignment>; categories: Record<string, Assignment>;
  createdAt: string; updatedAt: string; }
interface ProfileInput { id?: string; name: string; note?: string;
  agents: Record<string, Assignment>; categories: Record<string, Assignment>; }
type Drift = "inSync" | "drifted" | "noActive" | "configMissing" | "configInvalid";
interface Status { configPath: string; configExists: boolean; activeProfileId: string|null;
  drift: Drift; nativeBlockPresent: boolean; legacySenpiPresent: boolean;
  omoAvailable: boolean; configHash: string|null; }
interface SwitchPreview { profileId: string; baseHash: string;
  beforeNative: string; afterNative: string; changed: boolean; }
interface ApplyResult { changed: boolean; backupPath: string|null; configPath: string; }
interface ImportResult { profile: Profile; renamed: [string,string][]; }
interface ModelInfo { id: string; provider: string; model: string;
  context: string|null; maxOut: string|null; thinking: boolean; images: boolean; }
interface BackupInfo { path: string; createdAt: string; sizeBytes: number; }
type AppError = { kind: "configMissing"|"malformedJsonc"|"duplicateKey"|"changedOnDisk"
  |"verifyFailed"|"omoNotFound"|"omoListParse"|"io"|"storeCorrupt"|"profileNotFound"
  |"invalidProfile"|"notAnObject"; message: string; line?: number; col?: number; key?: string; field?: string; };
```

## Error Cases

`AppError` kinds are exactly: `configMissing`, `malformedJsonc{line,col}`, `duplicateKey{key}`, `changedOnDisk`, `verifyFailed`, `omoNotFound`, `omoListParse`, `io`, `storeCorrupt`, `profileNotFound`, `invalidProfile{field}`, and `notAnObject`, with a `message` field.

## Task 1: Scaffold, contract skeleton, git init

Save this plan, initialize git, hand-scaffold Vite React TS and the Tauri crate, pin all dependencies, generate icons, write `error.rs` and `paths.rs` with tests, create all module stubs, write the exact frontend contract, install Playwright Chromium, fetch the schema once and record its known enums in the `store.rs` stub.

Acceptance criteria:
- `cargo test --manifest-path src-tauri/Cargo.toml` passes, including paths tests for override set and unset.
- `pnpm build` exits 0.
- `git log` shows 1 commit.

## Commit Strategy

Use Conventional Commits, one commit per task, staging only the task's files:

1. `chore: scaffold tauri+react app, error/paths contract, plan`

2. `feat(core): comment-preserving JSONC span-splice editor with tests` (T2)
3. `feat(core): profile store and config import` (T3)
4. `feat(core): omo --list-models runner and parser` (T4)
5. `feat(ui): i18n, typed api, mock ipc, assignment logic` (T5)
6. `feat(core): apply/preview/drift/backup with atomic write` (T6)
7. `feat(ui): profile list, editor, preview, import, backups` (T7)
8. `feat(app): tauri commands, tray quick-switch, cli` (T8)
9. `test(e2e): playwright flows; chore: release build` (T9), then tag `v0.1.0`

Stage only task files. Before each commit grep fixtures for `(?i)(api[_-]?key|token|secret|bearer)` → 0 matches.

## Design Decisions

- Write mode: only `[native].agents` and `[native].categories` are owned and replaced wholesale. Everything else (other `[native]` keys, all comments, other blocks) stays byte-identical. Missing `[native]` → insert after `"[opencode]"` member, else as last root member. No OMO_PROFILE mode (env is read at process start; tray switch cannot reach running sessions).
- Import from `[opencode]`: rename `metis`→`plan-consultant`, `momus`→`plan-reviewer`; return renamed pairs.
- `[senpi]` present → warning only (`legacySenpiPresent`); never edited.
- Drift = canonical JSON (sorted keys) of file `[native].{agents,categories}` (missing = `{}`) ≠ active profile. UI polls `get_status` every 3 s + on focus; tray on open. Actions: Re-apply / Capture.
- Never read/display `~/.omo/agent/auth.json` or `~/.config/opencode/opencode.json`.

## Store Format

`%OMOSWITCH_HOME%\store.json`, atomic write (temp + rename):

```json
{ "version": 1, "activeProfileId": "uuid-or-null",
  "profiles": [ { "id": "uuid", "name": "Default (imported)", "note": "",
    "agents": { "sisyphus": { "model": "provider/model", "reasoning": "high", "models": ["p/m2"] } },
    "categories": { "quick": { "model": "provider/model" } },
    "createdAt": "2026-09-27T12:00:00Z", "updatedAt": "2026-09-27T12:00:00Z" } ] }
```

- Assignment = raw JSON object (`serde_json::Map`, order preserved). UI edits `model`, `reasoning`, `models`; other fields edited as "extra" JSON.
- Validation: name 1–64 chars, unique case-insensitive; keys `^[a-z0-9][a-z0-9-]*$`; reasoning ∈ off|minimal|low|medium|high|xhigh|max|auto; model non-empty.
- `models-cache.json` next to store: `{ "fetchedAt": "...", "models": [ModelInfo] }`.
- Corrupt store → `storeCorrupt`; rename to `store.json.corrupt.<ts>` only on user confirm.

## Backup Naming

`omo.jsonc.bak.omoswitch-<UTC YYYY-MM-DDTHH-MM-SSZ>` in the omo.jsonc dir; same-second collision → `-2`, `-3`. Backup only when new text ≠ current. Keep newest 20 `omoswitch-` backups; never touch OmO's own `.bak.<ISO>` files.

## Commands (args → returns; all `Result<T, AppError>`, camelCase)

| Command | Args | Returns |
|---|---|---|
| `get_status` | – | `Status` |
| `list_profiles` | – | `Profile[]` |
| `save_profile` | `{ input: ProfileInput }` | `Profile` |
| `delete_profile` | `{ id }` | `null` (active deleted → activeProfileId null) |
| `duplicate_profile` | `{ id, name }` | `Profile` |
| `import_from_config` | `{ source: "opencode"\|"native", name }` | `ImportResult` |
| `capture_active_from_config` | – | `Profile` |
| `preview_switch` | `{ id }` | `SwitchPreview` |
| `apply_profile` | `{ id, expectedHash?: string }` | `ApplyResult` (+ event `omoswitch://applied`) |
| `list_models` | `{ refresh: boolean }` | `ModelInfo[]` (cache first unless refresh) |
| `list_backups` | – | `BackupInfo[]` newest first |
| `restore_backup` | `{ path }` | `ApplyResult` (path must be in list; current file backed up first) |

CLI `omoswitch-cli` (JSON stdout, exit 0; failure exit 1 + JSON AppError on stderr): `status`, `list`, `import --from opencode|native --name <n>`, `preview <name|id>`, `apply <name|id>`, `models [--refresh]`, `backups`.

## Error Behavior

| Case | Behavior |
|---|---|
| Malformed JSONC | `malformedJsonc{line,col}`; no write; status `configInvalid` |
| Duplicate top-level `"[native]"` or duplicate `agents`/`categories` inside it | `duplicateKey{key}`; no write |
| Root or `[native]` not object | `notAnObject`; no write |
| File changed since load/preview (sha256 re-read before replace + `expectedHash`) | `changedOnDisk`; no write |
| `json5(new) != expected` | `verifyFailed`; no write |
| omo.jsonc missing | `configMissing`; never create file |
| omo not found / bad `OMOSWITCH_OMO_BIN` | `omoNotFound`; pickers fall back to cache then free text |
| list-models unparsable / 20 s timeout | `omoListParse` |

Spawn `omo` with `CREATE_NO_WINDOW` (0x08000000).

## Core Algorithm (`jsonc_edit.rs` + `omo_config.rs`)

1. Read bytes → sha256 `baseHash`. Newline = `\r\n` if any present else `\n`. Indent unit = first indented line, else 2 spaces.
2. Tokenize: strings (`"`, `'`), `//` and `/* */` comments, punctuation; record keys with depth and member value spans `[start,end)`.
3. Locate root object → `"[native]"` member → its `agents`/`categories`. Reject duplicates.
4. Serialize each subtree with serde_json pretty, re-indent to nesting depth, convert newlines. Replace existing value span; else insert member before `[native]`'s closing brace (fix commas, respect trailing commas); else insert whole `[native]` member after `"[opencode]"` (or last root member).
5. Verify: `json5(new) == json5(old)` with `[native].agents/categories` set; else `verifyFailed`.
6. `new == old` → `changed=false`, no backup, no write.
7. Write: re-read + re-hash vs baseHash (and expectedHash) → backup copy → temp `omo.jsonc.omoswitch.tmp` in same dir → Windows `ReplaceFileW(REPLACEFILE_IGNORE_MERGE_ERRORS)` (fallback `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`), other OS `rename` → set store `activeProfileId`.
8. Drift: canonical JSON compare of `[native].{agents,categories}` vs active profile.

## Tasks T2–T9

File-conflict rule: T1 declared all modules in `lib.rs`. Wave 2/3 tasks edit ONLY their own files. Nobody touches `lib.rs`, `Cargo.toml`, `package.json` before T8 (need a dep → report, don't add).

- **T2 `jsonc_edit.rs` (TDD, deep-low, [programming])** — fixtures first in `src-tauri/tests/fixtures/`: `user_shaped.jsonc` (structure of real file: `$schema`, `"[opencode]"` with 11 agents + 8 categories, `_migrations`, comments before/inside/after, trailing commas; NO secrets), `user_shaped_crlf.jsonc`, `with_native.jsonc`, `with_senpi.jsonc`, `dup_native.jsonc`, `dup_agents.jsonc`, `malformed.jsonc`, `empty_object.jsonc` variants. API: `parse_value(text)`, `set_native_subtrees(text, &Map, &Map) -> Result<String>`, `native_subtrees(text) -> Result<(Map, Map)>`, `has_key(text, top_key)`. Tests (a) bytes outside changed span identical (b) `[opencode]`/`$schema`/`_migrations` unchanged (c) CRLF in→CRLF out, no bare `\n` (d) idempotent (e) insert when absent; existing `[native]` extra keys/comments kept (f) duplicateKey (g) malformedJsonc line/col (h) empty object (i) strings with `//`, `{`, `"[native]"`, escaped quotes (j) round-trip. Accept: `cargo test jsonc_edit` ≥14 pass, no `unwrap()` on user data.
- **T3 `store.rs` (TDD, deep-low, [programming])** — load (missing → empty v1), atomic save, CRUD + validation, duplicate, set_active, `import_profile(&Value, source, name) -> ImportResult` (rename metis/momus for opencode), `canonical_eq`. Tests use inline JSON literals. Accept: `cargo test store` ≥8 pass.
- **T4 `models.rs` (TDD, deep-low, [programming])** — capture real `omo --list-models` stdout to `fixtures/list_models.txt`; parser (skip header, split on 2+ spaces, `id = provider/model`, yes/✓/true → bool); runner via `OMOSWITCH_OMO_BIN`, CREATE_NO_WINDOW, 20 s timeout; cache read/write. Accept: `cargo test models` ≥4 pass (fixture parse, garbage → omoListParse, missing bin → omoNotFound).
- **T5 frontend foundation (visual-engineering, [frontend, context7-mcp, programming])** — `src/lib/api.ts` (typed wrapper per command), `mockIpc.ts` (`mockIPC` from `@tauri-apps/api/mocks`, in-memory, 2 profiles + 30 models, `window.__omoswitchMock.setDrift()/setOmoMissing()`), `catalog.ts`, `assignment.ts` (split/merge keeping key order, `parseModelString("p/m:high")`, `validateProfileInput`), i18n ja default + en, key parity. Accept: `pnpm test` ≥12 pass, `pnpm build` 0.
- **T6 `omo_config.rs` (TDD, deep-low, [programming])** — load/status/preview/apply/capture/list_backups/restore_backup, atomic ReplaceFileW, disk guard, prune 20; tempfile tests (apply on user_shaped + backup + `[opencode]` byte-identical; second apply changed=false no backup; changedOnDisk; drift; configMissing; restore round-trip; prune; CRLF). Accept: `cargo test` fully green, omo_config ≥9.
- **T7 UI (visual-engineering, [frontend, visual-qa, playwright])** — StatusBar, ProfileList, ProfileEditor, AssignmentRow, ModelPicker (filter + free text + refresh, omoNotFound hint), SwitchPreview, ImportDialog (renamed notice), BackupsDialog, ErrorBanner (i18n per kind; changedOnDisk → reload preview), ja/en toggle, 3 s poll + focus, a11y (labels, focus trap, Esc, focus rings), Tailwind light/dark. Accept: build/test green, visual-qa PASS all states in ja, no hard-coded UI strings.
- **T8 commands/tray/CLI (deep-low, [context7-mcp, programming])** — `commands.rs` per contract (store reloaded per call), `lib.rs` single-instance + invoke_handler + hide on close, `tray.rs` checkbox item per profile + Open/Quit (OS-locale label) + tooltip `OmOswitch — <active|none> [drift]`, rebuild after mutations; tray click = apply without hash, error → show window + `omoswitch://error`; `bin/omoswitch-cli.rs`. Accept: cargo build/test green; cli `status` on temp home prints JSON.
- **T9 E2E + QA + release (unspecified-high, [playwright, visual-qa, debugging, git-master])** — `e2e/app.spec.ts` against `pnpm dev:mock`; run S1–S11; `pnpm tauri dev` tray smoke on temp home; ask user before S12.

## CORRECTION: native agent/category registry (verified at tag v5.0.1, ab725f3)

The catalog shipped in T5 was taken from the OpenCode edition and is WRONG for native. Authoritative sources: `packages/senpi-task/src/agents/builtin/index.ts#L14-L44`, `packages/omo-native/bin/lib/setup-opencode-models.js#L19-L27`, `packages/senpi-task/src/category/{builtins,google-categories,openai-categories,anthropic-categories,kimi-categories}.ts`, `packages/omo-config-core/src/schema/reasoning-vocabulary.ts#L1-L23`.

- **KNOWN_AGENTS (native, exactly 7):** `explore`, `librarian`, `plan-consultant`, `plan-reviewer`, `omo-native-code-reviewer`, `omo-native-qa-executor`, `omo-native-gate-reviewer`. Remove `sisyphus`, `hephaestus`, `prometheus`, `atlas`, `oracle`, `multimodal-looker`, `sisyphus-junior` — OpenCode-only; native `resolve-agent.ts#L78-L81` returns `not_found`. Native's main session has no agent entry (it uses the top-level default model), so there is no `sisyphus` equivalent to offer.
- **KNOWN_CATEGORIES (10):** unchanged and all valid.
- **REASONING_LEVELS:** `off, minimal, low, medium, high, xhigh, max` plus `auto`; input `none` normalizes to `off` (drop `none` from the UI).
- **Legacy agent aliases:** `omo-senpi-code-reviewer|gate-reviewer|qa-executor` → `omo-native-*` (resolved on read, `legacy-agent-names.ts`). `metis`→`plan-consultant` and `momus`→`plan-reviewer` are **migration-only** (removed from the native alias table in v5.0.0-beta.57), so they matter only for the `[opencode]` import path — which is what `store.rs::import_profile` already does.
- **Legacy category alias:** `deep` → `deep-low` (`legacy-category-names.ts#L8`), applied on read and by migration.
- **Keys are freeform:** `z.record(z.string(), ...)` for both agents and categories, so an unknown key is not a schema error — but native drops it at resolution. The UI must therefore treat the catalog as *suggestions* and still allow free text, while marking non-native keys.
- **Assignment fields are `.strict()`:** unknown properties inside an agent/category object are stripped with an `unknown-keys` diagnostic (`loader.ts#L219-L224`). The "extra JSON" editor must warn that arbitrary keys get dropped. Native-only fields worth exposing later: `execution_mode`, `background`, `max_depth`, `allowed_subagents`, `disallowed_tools`, `max_turns`; categories also take `top_p`, `max_tokens`, `prompt_append`, `provider_options`.

### Follow-up tasks (queued; must not collide with in-flight T6/T7)

- **T7b (`src/lib/catalog.ts`, visual-engineering):** replace KNOWN_AGENTS with the 7 native names, drop `none` from REASONING_LEVELS, add `LEGACY_AGENT_ALIASES` / `LEGACY_CATEGORY_ALIASES`, and surface a "not recognized by native" marker in `AssignmentRow`. Update `mockData.ts` seeds and any i18n keys; `pnpm test` + `pnpm build` must stay green.
- **T8b (`src-tauri/src/store.rs`, deep-low):** on `[opencode]` import, after renaming `metis`/`momus`, DROP agent keys outside the 7 native names and report them as `dropped` alongside `renamed` (contract change: `ImportResult.dropped: string[]`, mirrored in `types.ts` and the mock). Map category `deep`→`deep-low`. Add tests: importing the user-shaped `[opencode]` block yields exactly `plan-consultant`, `plan-reviewer` (renamed) and drops the 9 OpenCode-only agents.

## Concurrent writer: CC Switch (observed, not hypothetical)

CC Switch v3.20.4 is installed on this machine and actively writes the same file. Its own log recorded
`[2026-09-27][18:54:08][INFO][cc_switch_lib::services::omo] OMO config written to "C:\Users\tom\.omo\omo.jsonc"`,
and that write silently dropped the `deep-low` category from `[opencode].categories` (2416 -> 2373 bytes) — its OmO
adapter carries a pre-`2026-09-category-deep-split` category list and rewrites the whole `[opencode]` block from its
own SQLite DB. It made no backup of the file it replaced.

Consequences for OmOswitch:
- The changed-on-disk sha256 guard (`expectedHash` + re-read before replace) is not defensive over-engineering; a
  second writer demonstrably exists. Keep `changedOnDisk` surfaced in the UI with a reload-preview action.
- OmOswitch owns ONLY `[native].agents` / `[native].categories`. It must never widen that to `[opencode]`, or the two
  apps would fight over the same bytes.
- CC Switch's writes target `[opencode]` only, so a `[native]` block should survive them — but this is an observation
  about its current version, not a guarantee. S12 must re-read the file immediately before applying.
- Do not run CC Switch's OmO provider switch while OmOswitch is mid-apply.

## Scenario Contract

QA env (S5–S10 never touch real `~/.omo`; S6 reads it only as diff baseline):

```pwsh
$qa="$env:TEMP\omoswitch-qa"; New-Item -ItemType Directory -Force "$qa\omo","$qa\store" | Out-Null
Copy-Item "$env:USERPROFILE\.omo\omo.jsonc" "$qa\omo\omo.jsonc"
$env:OMOSWITCH_OMO_HOME="$qa\omo"; $env:OMOSWITCH_HOME="$qa\store"
$cli="src-tauri\target\debug\omoswitch-cli.exe"
```

| ID | Command | PASS iff |
|---|---|---|
| S1 | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, ≥40 tests, 0 failed |
| S2 | `pnpm test` | exit 0 |
| S3 | `pnpm build` | exit 0 |
| S4 | `pnpm e2e` | exit 0 |
| S5 | `& $cli import --from opencode --name base` | 11 agents incl. plan-consultant/plan-reviewer, no metis; 8 categories |
| S6 | `& $cli apply base` | changed:true, backup exists, `git diff --no-index` real vs temp shows changes only inside `"[native]"` |
| S7 | `& $cli apply base` again | changed:false, backup count unchanged |
| S8 | edit a model in temp `[native]`, `& $cli status` | drift:"drifted" |
| S9 | unit test `apply_rejects_changed_on_disk` | passes |
| S10 | `$env:OMOSWITCH_OMO_BIN="C:\nope.exe"; & $cli models` | exit 1, stderr kind omoNotFound |
| S11 | `pnpm tauri build` | exit 0; `src-tauri\target\release\omoswitch.exe` + NSIS/MSI bundle exist |
| S12 | (after user OK) backup real file, clear overrides, apply `base` via tray | real file has `[native]`, omoswitch backup exists, new reload entry in `~/.omo/agent/logs/config-reload.log`, `[opencode]` byte-identical |

Cleanup `$qa` after S12; keep `real-backup.jsonc` until the user OKs deletion.

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

## PHASE 2 — Provider & model management (the user's actual headline feature)

The user's priority is CC Switch's core: enter a baseURL + API key, keep several provider configs, switch between
them. What shipped so far (agent/category assignments) stays, but it is the *secondary* feature.

### Verified locally with omo itself (not inferred)

`omo --list-models` lists 46 provider ids, and **`wawazz-gpt`, `wawazz-gemini`, `coderplan-kiro` are NOT among them.**
`omo auth check --provider wawazz-gpt --json` returns `{"status":"not_ready","reason":"provider_not_found"}` (exit 1),
while a known provider returns `credentials_not_configured` instead — so the distinction is real, not a credential gap.

**Consequence: the `[native]` block applied in S12 is a dead reference.** Its assignments point at `wawazz-*` models
that native cannot resolve, because those providers exist only in `~/.config/opencode/opencode.json`, which native
reads *only* as an import source during `omo setup`. Provider management is therefore not a nice-to-have; without it
the model assignments OmOswitch already writes cannot take effect.

`omo setup --help` states the remedy in native's own words:

```
1 API key for providers omo does not serve (coderplan) - define the provider and its baseUrl in
  ~/.omo\agent\models.json, then /login <provider> inside omo
providers  coderplan-kiro -> https://api.coderplan.ai, 1 model (claude-opus-5), key from opencode config apiKey
           wawazz-gemini  -> https://wawazz.xyz/v1, 1 model (gemini-3.8-flash-high)
           wawazz-gpt     -> https://wawazz.xyz/v1, 2 models (gpt-6-astra, gpt-6-sol)
```

Same output independently confirms two things OmOswitch already gets right: native's agents are exactly the 7 in our
catalog (it enumerates them when rejecting `atlas`/`metis`/`oracle` etc.), and our restored `deep-low` is seen —
"1 you already set differently in omo (category deep-low) - kept as is".

Also observed: `~/.omo/agent/models.json` does **not** exist yet (nor `models.jsonc`, `settings.jsonc`, `mcp.json`),
and setup warns `node:sqlite unavailable; database credentials not imported`.

### Target files (from librarian @ e2a1d66, 2026-09-27T14:57Z)

- **`~/.omo/agent/models.json` — the authoritative provider file.** `{ providers: { <id>: { name?, baseUrl?, apiKey?,
  api?, headers?, authHeader?, compat?, models?: [{ id, name?, reasoning?, input?, contextWindow?, maxTokens?, cost? }],
  modelOverrides? } }, disabledProviders?: [] }`. `api` is a protocol name, NOT an npm package:
  `openai-completions` (default) / `openai-responses` / `anthropic-messages`. Engine hot-reloads it (config-watch
  watches `settings.jsonc`, `settings.json`, `models.json`, `keybindings.json`). Missing file = empty map, not an error.
- **`~/.omo/agent/auth.json` — credentials**, `{ "<provider-id>": { "type": "api_key", "key": "..." } }` or an `oauth`
  shape, mode 0600. Precedence: auth.json > inline `apiKey` in models.json > env var. Values support `$VAR`/`${VAR}`
  expansion and `!command` substitution.
- Agent dir override env vars: `OMO_CODING_AGENT_DIR`, `SENPI_CODING_AGENT_DIR`, `PI_CODING_AGENT_DIR`.
- **Must not touch:** `agent/settings.json` (engine rewrites it constantly), `agent/models-store.json` (lock-managed
  catalog cache), `mcp.json`, `trust.json`.
- CLI a switcher can lean on: `omo auth check --provider <id> --json`, `omo auth print-api-key --provider <id>`,
  `omo update --models`, `omo setup --dry-run|--yes`, `omo --list-models`.

### Design decisions for phase 2

1. **Write providers to `~/.omo/agent/models.json`; write keys to `~/.omo/agent/auth.json`** (not inline), so secrets
   stay in the 0600 file the engine already protects. Offer inline `apiKey` only as an explicit opt-out.
2. **Additive model, like CC Switch's OpenCode adapter:** all providers coexist in `models.json`; "switching" means
   enabling/disabling and choosing which models the agent/category assignments point at. Use `disabledProviders` for
   a disable toggle rather than deleting definitions.
3. **Reuse the proven core:** the same atomic-write + sha256 changed-on-disk guard + backup + JSONC comment
   preservation already built for `omo.jsonc`. `models.json` may legally carry comments, so it goes through the same
   span-splice editor, not `serde_json` round-tripping.
4. **Import from `opencode.json`** to seed providers (that is where the user's three live today), redacting nothing on
   read but never echoing keys into logs, previews, or error messages.
5. **Connectivity test copies CC Switch's design:** a cheap reachability probe, no inference request; 200/401/403/404
   all count as reachable since the point is network reachability, not auth.
6. **Model list:** manual table plus a live `GET {baseUrl}/models` fetch with `/v1/models` fallback, parsing both
   `{data:[{id}]}` and `{models:[{slug}]}`.
7. **Do NOT shell out to `omo setup --yes`** for the write path: it also rewrites model choices and MCP config, which
   is far wider than a provider switcher should do. Use it only as a read-only reference via `--dry-run`.

### Known trap (CC Switch fixed this; we must too)

IME composition: binding a model-id input straight to parent state and keying rows by model id unmounts the input on
Japanese IME commit and drops focus. CC Switch solves it with a local-state `ImeSafeInput` committing on blur. The
user types Japanese, so this is mandatory, not optional.

## Re-verified against latest dev (6c9e0aa, 2026-09-27T14:16Z)

Re-checked all five catalog lists against the default branch `dev` at `6c9e0aa4d20bb2d84b3e528693097210a30c9757`,
which is newer than tag v5.0.1 (`ab725f3`). **No change** — the 7 native agents, 10 categories, 8 reasoning levels,
the legacy agent/category/harness aliases, and the OpenCode-only drop list are all identical to what
`src/lib/catalog.ts` and `src-tauri/src/store.rs` already ship. Commits after v5.0.1 touched the computer-use engine
and Windows doctor fixes only. Native still has no main-session agent (no `sisyphus`/`build` equivalent); it runs the
top-level default model. Repo is not renamed or archived; npm names stay `omo-ai` (native) and `oh-my-opencode` (plugin).

Two migration ids exist after `2026-09-category-deep-split`
(`packages/omo-opencode/src/config-migration/migration-plans.ts`), both conditional — they only run and only get
recorded in `_migrations` when the legacy keys are actually present:
- `2026-09-harness-native-rename` — rewrites a `[senpi]` block to `[native]`.
- `2026-09-subscription-provider-rename` — `claude-sdk-oauth` -> `anthropic-subscription`,
  `openai-codex` -> `chatgpt-subscription`.

Neither affects OmOswitch's write path: it only ever writes `[native].agents` / `[native].categories`, already reports
`legacySenpiPresent` for a `[senpi]` block, and never rewrites provider ids. A `computer` settings block was added to
the `[native]` schema upstream; it is not an agent/category field and OmOswitch leaves it untouched like every other
`[native]` key.

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

# PHASE 2 PLAN — decisions (D1–D15)

**D1 Agent dir precedence:** `OMOSWITCH_OMO_AGENT_DIR` > `OMO_CODING_AGENT_DIR` > `<omo_home>/agent`.
`SENPI_/PI_CODING_AGENT_DIR` NOT honored. Consequence: QA runs under `OMOSWITCH_OMO_HOME` alone and gets a temp
agent dir for free. `Status` reports the resolved dir.

**D2 Generalize the editor, do not duplicate.** Add to `jsonc_edit.rs`:
`set_object_path(text,&[&str],&Value)`, `get_object_path`, `remove_object_path`. Refactor `root_and_native` into a
generic `resolve_path` walking the path, reusing the existing scanner (`skip`/`string_end`/`value_end`/`object_at`/
`key_at`) untouched. `set_native_subtrees`/`native_subtrees` become thin wrappers over
`&["[native]","agents"]` / `&["[native]","categories"]`. The 19 existing `jsonc_edit` + 11 `omo_config` tests are the
regression harness and must pass UNMODIFIED.

**D3 Two files, two owners:** `providers.rs` owns `<agent_dir>/models.json` (JSONC-safe via D2 + phase-1 atomic
write/backup/sha256 guard). `auth.rs` owns `<agent_dir>/auth.json`. Keys to auth.json by default; inline `apiKey`
only via explicit per-provider `inlineKey: true`.

**D4 Additive:** never delete to disable — use `disabledProviders`. Delete is a separate confirmed action.

**D5 Secret hygiene (hard invariants):** `ProviderInfo` carries `hasKey: boolean` + `keySource`, NEVER the value.
`auth.rs` exposes no getter returning a key; only `has_key(id)`. No key in any `AppError.message`, log, preview,
DOM node, backup filename, or argv. auth.json is never copied to `%TEMP%`; its atomic temp file lives in the agent
dir. No backups of auth.json (a backup is a second long-lived plaintext copy).

**D6 0600 honestly:** unix → `set_permissions(0o600)` on the temp file before rename. Windows → no chmod; the file
inherits the owner-only DACL of `%USERPROFILE%`; guarantee is only "never weaken it, never write outside the agent
dir". No DACL surgery.

**D7 HTTP crate `ureq` (blocking, rustls), NOT reqwest.** Two requests with 8s/15s timeouts need no async runtime;
reqwest pulls tokio+hyper. Pin exactly: `ureq = { version = "=3.x.y", default-features = false, features = ["rustls"] }`
— verify the exact latest 3.x patch via context7 at execution time. Tauri commands run on a thread pool so blocking is
safe. T0 records `cargo build` wall time before/after in its commit body so the cost is measured. If ureq 3 cannot be
pinned cleanly, fall back to `reqwest = { version = "=0.12.x", default-features = false,
features = ["rustls-tls","json","blocking"] }` and say so in the commit.

**D8 Preset catalog: 10 + Custom**, in `src/lib/providerCatalog.ts` ONLY (Rust never hardcodes a provider list, so the
two cannot drift): `openai`, `anthropic`, `deepseek`, `openrouter`, `groq`, `moonshot`, `zhipu`, `ollama`, `lmstudio`,
`google`, `custom`. Each `{ id, displayName, baseUrl, api, websiteUrl, apiKeyUrl, defaultModels[] }`. `api` is a
PROTOCOL name never an npm package: anthropic → `anthropic-messages`; rest → `openai-completions`; ollama/lmstudio →
localhost baseUrl, `apiKeyUrl: null`, no key required.

**D9 Probe:** `GET {baseUrl}` (no path append, no inference, no body), 8s timeout, `Authorization` only if a key
exists. Reachable ⇔ any HTTP response at all (200/401/403/404 included); unreachable ⇔ DNS/TLS/connect/timeout.
Tiers: `fast` <300ms, `ok` <1200ms, `slow` ≥1200ms. Returns
`{ reachable, status: number|null, latencyMs, tier, errorKind: "dns"|"tls"|"connect"|"timeout"|null }` — never a raw
error string that could echo a URL-embedded credential.

**D10 Live model fetch:** `GET {baseUrl}/models`; on 404/400 retry `{baseUrl}/v1/models`. 15s timeout. Parse
`{data:[{id}]}`, `{models:[{slug}]}`, and a bare `[{id}]`. Unparsable → `modelFetchParse`. Result is OFFERED as
checkboxes, never auto-written.

**D11 IME safety is structural.** New `src/components/ImeSafeInput.tsx`: local `useState` draft; `onChange` updates
draft only; commits on blur and on Enter when `event.nativeEvent.isComposing === false`; resyncs from props only
while unfocused. EVERY model-id/model-name/provider-id/provider-name/baseUrl field uses it. Rows keyed by a stable
generated `rowId`, NEVER by model id — keying by id is the other half of the trap. `ModelPicker`'s existing free-text
input migrates to it too (T10), fixing a pre-existing Japanese-input bug.

**D12 Assignments ↔ providers:** `ModelPicker` merges `omo --list-models` output with configured-provider models,
tagged by source. `AssignmentRow` shows a dead-reference warning when the `provider/` prefix is in neither set — the
exact state this machine is in now — with a one-click "configure this provider" jump pre-filling the id.

**D13 TDD everywhere.** Fixtures + failing tests first. Fixture keys are literally `TEST-NOT-A-REAL-KEY`.

**D14 New error kinds:** `providerNotFound`, `invalidProvider{field}`, `networkUnreachable`, `modelFetchParse`.
`configMissing` is NOT reused for a missing models.json (missing = empty map, not an error).

**D15 Commits:** Conventional Commits, one per task, staging only that task's owned files. Pre-commit gate:
`rg -i "(api[_-]?key|token|secret|bearer|sk-)"` over staged files returns only field-name identifiers and the literal
`TEST-NOT-A-REAL-KEY`.

## Phase 2 contract additions

```ts
type ProviderApi = "openai-completions" | "openai-responses" | "anthropic-messages";
type KeySource = "auth" | "inline" | "env" | "none";
interface ProviderModel { id: string; name?: string; reasoning?: boolean; contextWindow?: number; maxTokens?: number; }
interface ProviderInfo { id: string; name: string; baseUrl: string; api: ProviderApi;
  models: ProviderModel[]; enabled: boolean; hasKey: boolean; keySource: KeySource;
  inlineKey: boolean; knownToOmo: boolean; }
interface ProviderInput { id: string; name: string; baseUrl: string; api: ProviderApi;
  models: ProviderModel[]; inlineKey: boolean; }
interface ProvidersResult { agentDir: string; modelsJsonPath: string; providers: ProviderInfo[]; }
interface ProbeResult { reachable: boolean; status: number | null; latencyMs: number;
  tier: "fast" | "ok" | "slow"; errorKind: "dns"|"tls"|"connect"|"timeout"|null; }
interface FetchedModels { source: "models" | "v1/models"; ids: string[]; }
interface ProviderImportResult { imported: string[]; skipped: string[]; keysFound: number; }
```

9 new commands: `list_providers`, `save_provider{input}`, `delete_provider{id}`, `set_provider_enabled{id,enabled}`,
`set_provider_key{id,key}`, `clear_provider_key{id}`, `test_provider{id}`→`ProbeResult`,
`fetch_provider_models{id}`→`FetchedModels`, `import_providers_from_opencode`→`ProviderImportResult`.
`Status` gains `agentDir: string`, `modelsJsonPresent: boolean`, `providerCount: number`.
CLI gains: `providers`, `provider-add --id --base-url --api [--model …]`, `provider-enable <id>`,
`provider-disable <id>`, `provider-key <id> --stdin` (stdin ONLY — argv is visible in the process list),
`provider-test <id>`, `provider-models <id>`, `providers-import`.

### models.json shape written

```jsonc
{
  "providers": {
    "wawazz-gpt": { "name": "Wawazz GPT", "baseUrl": "https://wawazz.xyz/v1",
      "api": "openai-completions", "models": [{ "id": "gpt-6-astra" }, { "id": "gpt-6-sol" }] }
  },
  "disabledProviders": []
}
```

## Phase 2 file ownership (no two parallel tasks share a file)

| File | Sole owner |
|---|---|
| `error.rs`, `paths.rs`, `lib.rs`, `Cargo.toml` | T0 (T9 re-opens `lib.rs` alone in Wave 4) |
| `jsonc_edit.rs`, `tests/fixtures/models_json_*.jsonc` | T1 |
| `net.rs` | T2 |
| `auth.rs`, `tests/fixtures/auth_json_*.json` | T3 |
| `types.ts`, `api.ts`, `mockIpc.ts`, `mockData.ts`, `providerCatalog.ts` | T4 |
| `i18n/ja.json`, `i18n/en.json` | T5 |
| `components/ImeSafeInput.tsx` + its test | T6 |
| `providers.rs` | T7 |
| `components/ProviderList.tsx`, `ProviderEditor.tsx`, `ProviderModelsTable.tsx` | T8 |
| `commands.rs`, `tray.rs`, `bin/omoswitch-cli.rs`, `lib.rs` | T9 |
| `App.tsx`, `components/AssignmentRow.tsx`, `components/ModelPicker.tsx` | T10 |
| `e2e/providers.spec.ts`, `e2e/providerKey.spec.ts`, `e2e/helpers.ts` | T11 |
| `.omo/plans/omoswitch.md`, `README.md` | T12 |

## Phase 2 waves

**Wave 1 — T0 alone (owns every shared file; must finish before anything else starts).**
`deep-low`, skills [`programming`,`context7-mcp`]. Add the 4 D14 error kinds to `error.rs`; add
`agent_dir()`/`models_json_path()`/`auth_json_path()` to `paths.rs` with D1 precedence + 4 tests (derived from
omo_home / `OMO_CODING_AGENT_DIR` honored / `OMOSWITCH_OMO_AGENT_DIR` wins / defaults); declare
`pub mod providers; pub mod auth; pub mod net;` in `lib.rs` with compiling stubs; pin `ureq` per D7.
Accept: `cargo test` ≥52 pass 0 failed; `cargo build` links ureq.
Commit: `chore(core): agent-dir paths, provider error kinds, ureq pin`

**Wave 2 — T1..T6 in parallel (all depend only on T0).**
- T1 `deep-low` [`programming`,`refactor`] — D2 generalization. Fixtures first: `models_json_commented.jsonc`
  (providers + `//` and `/* */` comments before/inside/after, trailing comma), `_crlf`, `_empty` (`{}`),
  `_dup_providers`, `_disabled`. ≥9 new tests: nested insert into missing `providers`; replace one provider leaving
  sibling bytes identical; CRLF in→out no bare `\n`; idempotency; comment preservation; `remove_object_path` fixes
  commas; duplicate key at depth → `duplicateKey`; deep path into non-object → `notAnObject`; `path=[]` rejected.
  Accept: `cargo test jsonc_edit` ≥28 pass with the 19 existing tests UNMODIFIED; `cargo test omo_config` still 11.
  Commit: `refactor(core): generalize JSONC span-splice to arbitrary object paths`
- T2 `deep-low` [`programming`,`context7-mcp`] — `net.rs` per D9/D10. Tests use a local `std::net::TcpListener` stub,
  NO real network. Accept: `cargo test net` ≥7 pass incl. an assertion that a credential-looking URL segment never
  appears in the error string. Commit: `feat(core): provider reachability probe and live model fetch`
- T3 `deep-low` [`programming`] — `auth.rs` per D5/D6: `has_key`/`set_key`/`clear_key`/`key_source`. Accept:
  `cargo test auth` ≥6 pass; unix mode 0600 assertion; temp-parent == agent dir; no fn returns a key.
  Commit: `feat(core): auth.json credential store with restricted permissions`
- T4 `visual-engineering` [`frontend`,`programming`] — contract types + 9 api wrappers + 9 mock cases +
  `window.__omoswitchMock.setProviderProbe/setProviderFetch/setKeyPresent` + 3 seed providers (one disabled, one
  dead-reference matching reality) + `providerCatalog.ts` (D8). Accept: `pnpm test` ≥43 pass; `pnpm build` 0; no `any`.
  Commit: `feat(ui): provider contract, mock backend, preset catalog`
- T5 `quick` [] — `provider.*` + 4 `error.*` keys in BOTH `ja.json` and `en.json`, identical key sets; rename/delete
  nothing; touch no `.tsx`. Accept: `pnpm test` green incl. i18n parity.
  Commit: `feat(ui): japanese and english strings for provider management`
- T6 `visual-engineering` [`frontend`,`programming`] — `ImeSafeInput` per D11. Five tests first, demonstrated RED
  against a naive onChange passthrough: mid-composition parent state unchanged; commit once on compositionend+blur;
  Enter during composition does not commit; focus retained across parent re-render; external prop change while
  focused does not clobber the draft. Commit: `feat(ui): IME-safe text input committing on blur`

**Wave 3 — T7, T8 in parallel.**
- T7 `deep-low` [`programming`] — `providers.rs`: `list(paths, omo_models)`, `save(paths, ProviderInput)`,
  `delete(paths, id)`, `set_enabled(paths, id, bool)` via `disabledProviders`, `import_from_opencode(paths)` reading
  `~/.config/opencode/opencode.json` (keys routed to `auth.rs`, never echoed). All writes via
  `jsonc_edit::set_object_path` + phase-1 atomic write + sha256 changed-on-disk guard +
  `models.json.bak.omoswitch-<ts>` pruned to 20. Missing models.json → create `{"providers":{}}`; missing = empty map,
  never `configMissing`. Validation: id `^[a-z0-9][a-z0-9-]*$`, baseUrl non-empty `http(s)://`, `api` ∈ the 3
  protocols → else `invalidProvider{field}`. Accept: `cargo test providers` ≥10 pass incl. comment preservation,
  sibling bytes identical, disable-without-delete, idempotent save `changed:false` no backup, prune keeps 20, and
  zero key bytes in models.json when `inlineKey` is false.
  Commit: `feat(core): provider service writing ~/.omo/agent/models.json`
- T8 `visual-engineering` [`frontend`,`visual-qa`] — `ProviderList.tsx` (name, id, baseUrl, enabled toggle,
  hasKey/keySource badge, knownToOmo badge, test button + latency tier, edit/delete), `ProviderEditor.tsx` (preset
  dropdown pre-filling baseUrl/api/models; id/name/baseUrl/api select; key field password-type write-only showing
  "key set" not the value, plus clear-key; `inlineKey` opt-out with explicit warning; model table), 
  `ProviderModelsTable.tsx` (rows keyed by generated `rowId`, every text cell an `ImeSafeInput`, fetch-models merge as
  checkboxes). All strings from T5; a11y labels/focus trap/Esc/focus rings; light+dark.
  Accept: `pnpm build` + `pnpm test` green; visual-qa PASS on 5 states (empty, populated, disabled, key-set,
  probe-failed) × ja/en × light/dark; no key value in any DOM node.
  Commit: `feat(ui): provider list, editor, and model table screens`

**Wave 4 — T9, T10 in parallel.**
- T9 `deep-low` [`programming`,`context7-mcp`] — 9 commands in `commands.rs`, registered in the `lib.rs`
  `invoke_handler`; `Status` + `agentDir`/`modelsJsonPresent`/`providerCount`; tray tooltip provider count; 8 CLI
  subcommands with `provider-key` reading stdin ONLY. Accept: full `cargo test` green; `omoswitch-cli providers` on a
  temp home prints `providers:[]` exit 0; `rg -- "--key" src-tauri/src/bin/omoswitch-cli.rs` → 0 matches.
  Commit: `feat(app): provider tauri commands, tray count, cli subcommands`
- T10 `visual-engineering` [`frontend`,`visual-qa`] — Providers view in `App.tsx` on the existing 3s poll/focus cycle;
  `ModelPicker` merges configured-provider models with `omo --list-models` tagged by source and adopts `ImeSafeInput`;
  `AssignmentRow` dead-reference warning + "configure this provider" jump pre-filling the id (D12).
  Accept: warning renders for seeded `wawazz-gpt` and clears once configured; Japanese model entry keeps focus.
  Commit: `feat(ui): providers view, provider-aware model picker, dead-reference warning`

**Wave 5 — T11 then T12.**
- T11 `visual-engineering` [`playwright`,`frontend`] — `e2e/providers.spec.ts` (list renders; add via preset;
  enable/disable; delete with confirm; test button shows tier; fetch-models merges ids; dead-reference warning appears
  then clears) + `e2e/providerKey.spec.ts` (set key → "key set" badge; clear key; NO key text anywhere in
  `page.content()`; IME Japanese entry into a model cell keeps focus); extend `e2e/helpers.ts`.
  Accept: `pnpm e2e` ≥18 pass on the **Edge channel** — do NOT switch to Chromium, its download times out here.
  Commit: `test(e2e): provider management flows against the mock`
- T12 `unspecified-high` [`debugging`,`playwright`,`git-master`,`visual-qa`] — run P1–P10, paste real outputs, fix
  anything red; update `README.md` env vars; ASK THE USER before P-final; then tag `v0.2.0`.
  Commit: `test(qa): phase 2 scenario contract; docs: provider env vars`

## Phase 2 scenario contract (binary, exact commands)

One `OMOSWITCH_OMO_HOME` gives a temp agent dir for free (D1); nothing below touches real `~/.omo`:

```pwsh
$qa="$env:TEMP\omoswitch-qa2"
New-Item -ItemType Directory -Force "$qa\omo\agent","$qa\store" | Out-Null
Copy-Item "$env:USERPROFILE\.omo\omo.jsonc" "$qa\omo\omo.jsonc"
$env:OMOSWITCH_OMO_HOME="$qa\omo"; $env:OMOSWITCH_HOME="$qa\store"
Remove-Item Env:\OMO_CODING_AGENT_DIR -ErrorAction SilentlyContinue
$cli="src-tauri\target\debug\omoswitch-cli.exe"
```

| ID | Command | PASS iff |
|---|---|---|
| P1 | `cargo test --manifest-path src-tauri\Cargo.toml` | exit 0, ≥85 tests, 0 failed |
| P2 | `pnpm test` | exit 0, ≥50 tests |
| P3 | `pnpm build` | exit 0 |
| P4 | `pnpm e2e` | exit 0, ≥18 passed |
| P5 | `& $cli providers` | exit 0; `agentDir` = `$qa\omo\agent`; `providers` = `[]`; **`models.json` still absent** (list must not create it) |
| P6 | `& $cli provider-add --id wawazz-gpt --base-url https://wawazz.xyz/v1 --api openai-completions --model gpt-6-astra --model gpt-6-sol` | exit 0; models.json exists, json5-parses, contains both ids; `disabledProviders` absent or `[]` |
| P7 | add a comment + a second provider by hand, then `& $cli provider-add --id deepseek --base-url https://api.deepseek.com --api openai-completions --model deepseek-chat` | exit 0; `git diff --no-index` shows changes ONLY inside the `providers` object; the hand-added comment byte-identical; the hand-added provider untouched |
| P8 | `"TEST-NOT-A-REAL-KEY" \| & $cli provider-key wawazz-gpt --stdin` then `& $cli providers` | exit 0; `hasKey:true`, `keySource:"auth"`; `rg -F "TEST-NOT-A-REAL-KEY" models.json` → 0 matches; present in `auth.json`; 0 matches across both commands' stdout+stderr |
| P9 | `& $cli provider-disable wawazz-gpt; & $cli providers` | exit 0; `enabled:false`; definition and models still present (no deletion) |
| P10 | `$env:OMOSWITCH_OMO_AGENT_DIR="$qa\alt-agent"; & $cli providers` | exit 0; `agentDir` = `$qa\alt-agent`; `providers` = `[]`. Then `Remove-Item Env:\OMOSWITCH_OMO_AGENT_DIR` |
| **P-final** | **After explicit user OK only.** Back up `~\.omo\agent` if present; clear all `OMOSWITCH_*`; add `wawazz-gpt` via the GUI with its real key; then `omo auth check --provider wawazz-gpt --json` | response no longer says `provider_not_found` (`credentials_not_configured` or `ready` both PASS — the point is the provider resolves). `~\.omo\omo.jsonc` byte-identical throughout. Keep the backup until the user OKs deletion; then remove `$qa`. |

## Phase 2 success criteria

1. P1–P10 PASS with pasted evidence; P-final PASS after user OK.
2. `omo auth check --provider wawazz-gpt --json` no longer reports `provider_not_found`.
3. All 19 pre-existing `jsonc_edit` and 11 `omo_config` tests pass UNMODIFIED after the T1 generalization.
4. No key material in any log, error message, preview, DOM node, backup filename, models.json, or argv.
5. Japanese typed into every model-id/name field commits correctly and retains focus.
6. `pnpm tauri build` still produces `omoswitch.exe` + NSIS + MSI.
7. 13 commits, one per task, clean tree, tagged `v0.2.0`.

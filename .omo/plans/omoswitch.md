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

<!-- The full plan continues in the source session; Task 1 follows only the sections above and the complete contract in that session. -->

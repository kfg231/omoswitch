# OmOswitch

**Profile switcher for OmO Native configuration**

Windows desktop application for managing and switching between named model-assignment profiles for [OmO Native](https://github.com/code-yeongyu/oh-my-openagent) (omo 5.0+). Inspired by [CCswitch](https://github.com/farion1231/ccswitch).

> **⚠️ Disclaimer**: This is a personal project created for individual use. It is provided "as-is" without warranty of any kind. The author makes no guarantees regarding functionality, reliability, or continued maintenance. Use at your own risk.

[日本語版はこちら](./README.ja.md)

---

## Features

- **Profile Management**: Create, duplicate, delete, and switch between model assignment profiles
- **Hot Reload Support**: Changes to `omo.jsonc` are detected automatically; native config hot-reloads instantly
- **Provider Management**: Add, configure, enable/disable AI providers with secure API key storage
- **Model Assignment**: Assign models to agents and categories with fallback models and custom parameters
- **Drift Detection**: Detects when the config file diverges from the active profile (re-apply or capture)
- **Backup & Restore**: Automatic backups before every config change; restore from backup history
- **Import**: Import existing agent/category assignments from `[opencode]` or `[native]` blocks
- **Dual Language**: Japanese and English UI
- **CLI Tools**: Command-line interface for scripting and automation
- **System Tray**: Quick profile switching from the system tray

---

## Installation

### Prerequisites

- Windows 10/11 (x64)
- [OmO Native](https://github.com/code-yeongyu/oh-my-openagent) 5.0.1 or later installed and available on PATH

### Download

Download the latest installer from [Releases](https://github.com/kfg231/omoswitch/releases):

- **MSI Installer**: `OmOswitch_0.2.0_x64_en-US.msi`
- **NSIS Installer**: `OmOswitch_0.2.0_x64-setup.exe`

Run the installer and follow the prompts. OmOswitch will be added to your Start Menu.

---

## Usage

### GUI

Launch **OmOswitch** from the Start Menu or system tray.

#### Profiles Tab

- **Import from config**: Import agents and categories from your existing `omo.jsonc`
- **New profile**: Create a blank profile
- **Apply**: Write the selected profile to `[native]` block in `omo.jsonc`
- **Duplicate**: Copy a profile
- **Delete**: Remove a profile

The active profile is marked with an **Active** badge. When the file content diverges from the active profile, OmOswitch shows:
- **Re-apply**: Overwrite the file with the active profile
- **Capture**: Update the active profile from the current file content

#### Providers Tab

- **Add Provider**: Configure a new AI provider (API URL, model list, API key)
- **Enable/Disable**: Toggle provider availability
- **Test**: Verify provider reachability and latency
- **Fetch Models**: Retrieve model list from provider's `/v1/models` endpoint
- **Import**: Import providers from existing `~/.omo/agent/models.json`

Providers are written to `~/.omo/agent/models.json`. API keys are stored separately in `~/.omo/agent/auth.json` and never displayed.

### CLI

The `omoswitch-cli` binary is installed alongside the GUI.

```powershell
# List profiles
omoswitch-cli list

# Apply a profile by name or ID
omoswitch-cli apply "My Profile"

# Import from [opencode] or [native]
omoswitch-cli import opencode --name "Imported"

# List models from omo
omoswitch-cli models

# Provider management
omoswitch-cli providers
omoswitch-cli provider-add --id my-provider --base-url https://api.example.com --api openai-completions --model gpt-4
omoswitch-cli provider-key my-provider --stdin
omoswitch-cli provider-enable my-provider
omoswitch-cli provider-test my-provider

# Backups
omoswitch-cli backups
```

---

## Configuration

OmOswitch honors the following environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `OMOSWITCH_OMO_HOME` | `%USERPROFILE%\.omo` | Directory containing `omo.jsonc` |
| `OMOSWITCH_HOME` | `%USERPROFILE%\.omoswitch` | Profile store directory |
| `OMOSWITCH_OMO_BIN` | `omo` (on PATH) | Path to `omo` executable |
| `OMOSWITCH_OMO_AGENT_DIR` | (auto-detected) | OmO agent directory containing `models.json` and `auth.json` |

### Profile Storage

Profiles are stored in `%OMOSWITCH_HOME%\store.json`. Each profile contains:
- Agent assignments (`[native].agents`)
- Category assignments (`[native].categories`)
- Metadata (name, note, timestamps)

### Config Editing

OmOswitch edits only the `[native].agents` and `[native].categories` blocks in `omo.jsonc`. All other keys, comments, and formatting are preserved byte-for-byte. Edits are atomic (write-then-replace) with automatic backups.

Backups are named `omo.jsonc.bak.omoswitch-<UTC timestamp>` and stored in the same directory as `omo.jsonc`. The 20 most recent OmOswitch backups are kept.

---

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ and [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/) 1.70+ (stable toolchain)
- Windows 10/11 SDK (for Tauri)

### Build Steps

```powershell
# Install dependencies
pnpm install

# Run tests
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml

# Development mode
pnpm dev

# Production build
pnpm build
pnpm tauri build
```

Installers are output to `src-tauri/target/release/bundle/`.

---

## Tech Stack

- **Frontend**: React 18.3 + TypeScript + Vite 7 + Tailwind CSS 4
- **Backend**: Rust + Tauri 2.8
- **Internationalization**: i18next + react-i18next
- **Testing**: Vitest (unit), Playwright (E2E), Rust built-in tests

---

## License

MIT License

OmOswitch includes an implementation pattern inspired by [CCswitch](https://github.com/farion1231/ccswitch) (MIT License), specifically its atomic configuration write and changed-on-disk guard.

---

## Version History

### v0.2.0 (Current)

- Provider management UI and CLI
- Model assignment with fallback models
- Per-provider custom JSON fields
- Secure API key storage in `auth.json`
- Model list fetching from providers
- Improved drift detection and apply state UI

### v0.1.0

- Initial release
- Profile management (create, apply, duplicate, delete)
- Import from `[opencode]` and `[native]`
- Drift detection and capture
- Backup and restore
- Japanese and English UI
- System tray integration

---

## Support

For issues or questions, please open an issue on [GitHub](https://github.com/kfg231/omoswitch/issues).

**Note**: As this is a personal project, support and updates are provided on a best-effort basis with no guaranteed response time or continuation.

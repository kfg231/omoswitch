# OmOswitch

Windows desktop profile switcher for OmO Native configuration.

## Build

```text
pnpm install
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

Environment overrides:

- `OMOSWITCH_OMO_HOME`: OmO home (default `%USERPROFILE%\.omo`)
- `OMOSWITCH_HOME`: profile store (default `%USERPROFILE%\.omoswitch`)
- `OMOSWITCH_OMO_BIN`: OmO executable (default `omo`)
- `OMOSWITCH_OMO_AGENT_DIR`: OmO agent dir holding `models.json` / `auth.json`
  (precedence: this > `OMO_CODING_AGENT_DIR` > `<OmO home>\agent`)

## Providers

Providers are written to `<agent dir>\models.json`; API keys go to `<agent dir>\auth.json`
and are never shown, logged, or passed on the command line.

```text
omoswitch-cli providers
omoswitch-cli provider-add --id <id> --base-url <url> --api openai-completions --model <model>
omoswitch-cli provider-key <id> --stdin
omoswitch-cli provider-enable <id> | provider-disable <id>
omoswitch-cli provider-test <id> | provider-models <id>
omoswitch-cli providers-import
```

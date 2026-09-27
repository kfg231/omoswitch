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

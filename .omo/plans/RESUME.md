# RESUME — OmOswitch 引き継ぎ

最終更新: 2026-09-27 / 最終コミット `039d2fd` / 作業ツリー: clean / コミット数 20

## いまどこにいるか

**Phase 1 は完成・出荷済み。Phase 2 は計画完了・実装未着手（T0 未起動）。**

再開する人の最初の一手: このファイルを読んだあと `.omo/plans/omoswitch.md` の
「## Phase 2 waves」を読み、Wave 1 の T0 を 1 つだけ起動する。T0 は共有ファイル
(`error.rs` / `paths.rs` / `lib.rs` / `Cargo.toml`) を単独所有するので、T0 完了前に
Wave 2 を起動してはいけない。

## 検証済みの現状（ツール出力で確認した事実のみ）

| 項目 | 値 |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml` | 48 pass / 0 fail / exit 0 |
| `pnpm test` | 35 pass / exit 0 |
| `pnpm e2e` | 10 pass / exit 0（**Edge チャンネル**。Chromium は DL がタイムアウトする） |
| `pnpm build` | exit 0 |
| `pnpm tauri build` | `omoswitch.exe` 8.6MB + NSIS 2.0MB + MSI 3.4MB 生成済み |

## Phase 1 で何ができているか

`~/.omo/omo.jsonc` の `[native]` ブロックに agents/categories のモデル割当を書く
プロファイル切替アプリ。コメント・CRLF 保持の JSONC スプライス編集、sha256 による
ディスク変更ガード、アトミック書込（ReplaceFileW）、バックアップ 20 件保持、
Tauri コマンド 12 個、トレイ切替、`omoswitch-cli`、React 画面 11 個、ja/en i18n。

S12 として実ファイルへ適用済み: `[opencode]` はバイト不変、削除行 0、`deep-low` を
`[native]` 内に復元、2 回目適用は `changed:false`。

## Phase 2 が存在する理由（これが本題）

**ユーザーの本来の要望は CC Switch と同じプロバイダ管理**（baseURL と API キーを
入力して切り替える）。Phase 1 のモデル割当はその付随物。

そして Phase 1 が書いた `[native]` は**現状デッドリンク**。`omo` 自身で確認済み:

- `omo --list-models` が知るのは 46 プロバイダ。`wawazz-gpt` / `wawazz-gemini` /
  `coderplan-kiro` は**含まれない**
- `omo auth check --provider wawazz-gpt --json` → `{"status":"not_ready",
  "reason":"provider_not_found"}` (exit 1)。既知プロバイダなら
  `credentials_not_configured` が返るので、この違いは実在する
- `~/.omo/agent/models.json` は**まだ存在しない**

`omo setup --help` が native 自身の言葉で解決策を示している:
「define the provider and its baseUrl in `~/.omo\agent\models.json`, then
`/login <provider>` inside omo」

つまり Phase 2 の完了条件は `omo auth check --provider wawazz-gpt --json` が
`provider_not_found` を返さなくなること（P-final）。

## 引き継ぎ時に踏みやすい罠

1. **調査は subagent に委譲する。** ユーザーから明示の指示あり: 自分で GitHub を
   fetch し直すな、コンテキストとトークンの無駄。
2. **subagent の報告は切り詰められることがある。** T1 が保存した計画は T2-T9 が
   欠落、T4/T6/T8 の報告は取得失敗した。**テスト件数・ファイル一覧などツール出力で
   検証すること**。報告文を信用しない。
3. **CC Switch v3.20.4 が同じ `omo.jsonc` を書く。** 実際に `deep-low` を消した
   （同アプリのログに 18:54:08 の書込記録）。バックアップを取らない。だから
   sha256 ガードは過剰防御ではない。`[opencode]` には絶対に書かない。
4. **Playwright は Edge 固定。** Chromium に切り替えるな。
5. **秘密情報。** `~/.config/opencode/opencode.json` と `~/.omo/agent/auth.json` は
   API キーを含む。値をエコーしない。fixture のキーは `TEST-NOT-A-REAL-KEY` 固定。
6. **日本語 IME。** モデル ID 入力欄で `onChange` を親 state に直結し、行を
   model id で key 付けすると IME 確定でフォーカスが飛ぶ。D11 の `ImeSafeInput` は
   必須（ユーザーは日本語入力する）。

## 保留中の判断

- **P-final の実行前にユーザーの承認が必要。** 実ファイル `~/.omo/agent/` へ本物の
  API キーを書く工程。
- **`C:\Users\tom\Downloads\omo.jsonc.pre-omoswitch-2026-09-27T23-19-18Z.bak`**
  (2373 bytes) は S12 前のバックアップ。ユーザーが納得したら削除して良い。
- **GUI 未起動。** `omoswitch.exe` を Tauri ウィンドウとして立ち上げた確認は未実施。
  検証は CLI と mock ブラウザ e2e で行った。
- **インストール未実施。** インストーラは生成済みだが実行していないので
  `%LOCALAPPDATA%\Programs\OmOswitch` は存在しない。

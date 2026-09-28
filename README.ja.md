# OmOswitch

**OmO Native 設定用プロファイル切り替えツール**

[OmO Native](https://github.com/code-yeongyu/oh-my-openagent) (omo 5.0+) のモデル割り当てプロファイルを管理・切り替えるための Windows デスクトップアプリケーションです。[CCswitch](https://github.com/farion1231/ccswitch) からインスピレーションを得ています。

> **⚠️ 免責事項**: これは個人用に作成されたプロジェクトです。いかなる種類の保証もなく「現状のまま」提供されます。作者は機能性、信頼性、継続的なメンテナンスについて一切保証しません。ご自身の責任でご利用ください。

[English version](./README.md)

---

## 機能

- **プロファイル管理**: モデル割り当てプロファイルの作成、複製、削除、切り替え
- **ホットリロード対応**: `omo.jsonc` の変更を自動検知、native 設定が即座にリロード
- **プロバイダ管理**: AI プロバイダの追加、設定、有効/無効化、API キーの安全な保管
- **モデル割り当て**: エージェントとカテゴリへのモデル割り当て、フォールバックモデル、カスタムパラメータ対応
- **差分検知**: 設定ファイルとアクティブプロファイルの不一致を検知（再適用 or 取り込み）
- **バックアップ & 復元**: 設定変更前の自動バックアップ、履歴からの復元
- **インポート**: `[opencode]` や `[native]` ブロックから既存の割り当てをインポート
- **多言語対応**: 日本語・英語 UI
- **CLI ツール**: スクリプト・自動化のためのコマンドラインインターフェース
- **システムトレイ**: トレイから素早くプロファイル切り替え

---

## インストール

### 前提条件

- Windows 10/11 (x64)
- [OmO Native](https://github.com/code-yeongyu/oh-my-openagent) 5.0.1 以降がインストールされ、PATH に含まれていること

### ダウンロード

最新のインストーラーを [Releases](https://github.com/kfg231/omoswitch/releases) からダウンロードしてください:

- **MSI インストーラー**: `OmOswitch_0.2.0_x64_en-US.msi`
- **NSIS インストーラー**: `OmOswitch_0.2.0_x64-setup.exe`

インストーラーを実行し、画面の指示に従ってください。OmOswitch はスタートメニューに追加されます。

---

## 使い方

### GUI

スタートメニューまたはシステムトレイから **OmOswitch** を起動してください。

#### プロファイルタブ

- **設定から取り込む**: 既存の `omo.jsonc` からエージェントとカテゴリをインポート
- **新規プロファイル**: 空のプロファイルを作成
- **適用**: 選択したプロファイルを `omo.jsonc` の `[native]` ブロックに書き込み
- **複製**: プロファイルをコピー
- **削除**: プロファイルを削除

アクティブなプロファイルには **適用中** バッジが表示されます。ファイルの内容がアクティブプロファイルと異なる場合、以下のオプションが表示されます:
- **再適用**: アクティブプロファイルでファイルを上書き
- **取り込む**: 現在のファイル内容でアクティブプロファイルを更新

#### プロバイダタブ

- **プロバイダを追加**: 新しい AI プロバイダを設定（API URL、モデルリスト、API キー）
- **有効/無効**: プロバイダの利用可否を切り替え
- **テスト**: プロバイダへの到達可能性とレイテンシを確認
- **モデル取得**: プロバイダの `/v1/models` エンドポイントからモデルリストを取得
- **インポート**: 既存の `~/.omo/agent/models.json` からプロバイダをインポート

プロバイダは `~/.omo/agent/models.json` に保存されます。API キーは別ファイル `~/.omo/agent/auth.json` に保管され、画面には表示されません。

### CLI

GUI と一緒に `omoswitch-cli` バイナリがインストールされます。

```powershell
# プロファイル一覧
omoswitch-cli list

# 名前または ID でプロファイルを適用
omoswitch-cli apply "My Profile"

# [opencode] または [native] からインポート
omoswitch-cli import opencode --name "Imported"

# omo からモデル一覧を取得
omoswitch-cli models

# プロバイダ管理
omoswitch-cli providers
omoswitch-cli provider-add --id my-provider --base-url https://api.example.com --api openai-completions --model gpt-4
omoswitch-cli provider-key my-provider --stdin
omoswitch-cli provider-enable my-provider
omoswitch-cli provider-test my-provider

# バックアップ
omoswitch-cli backups
```

---

## 設定

OmOswitch は以下の環境変数に対応しています:

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `OMOSWITCH_OMO_HOME` | `%USERPROFILE%\.omo` | `omo.jsonc` が格納されているディレクトリ |
| `OMOSWITCH_HOME` | `%USERPROFILE%\.omoswitch` | プロファイル保存ディレクトリ |
| `OMOSWITCH_OMO_BIN` | `omo` (PATH 上) | `omo` 実行ファイルのパス |
| `OMOSWITCH_OMO_AGENT_DIR` | (自動検出) | `models.json` と `auth.json` が格納される OmO エージェントディレクトリ |

### プロファイルの保存場所

プロファイルは `%OMOSWITCH_HOME%\store.json` に保存されます。各プロファイルには以下が含まれます:
- エージェント割り当て (`[native].agents`)
- カテゴリ割り当て (`[native].categories`)
- メタデータ（名前、メモ、タイムスタンプ）

### 設定ファイル編集

OmOswitch は `omo.jsonc` 内の `[native].agents` と `[native].categories` ブロックのみを編集します。その他のキー、コメント、フォーマットはバイト単位で保持されます。編集はアトミック（一時ファイル書き込み→置換）で、自動バックアップ付きです。

バックアップは `omo.jsonc.bak.omoswitch-<UTC タイムスタンプ>` という名前で `omo.jsonc` と同じディレクトリに保存されます。最新 20 個の OmOswitch バックアップが保持されます。

---

## ソースからビルド

### 前提条件

- [Node.js](https://nodejs.org/) 18+ と [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/) 1.70+ (stable toolchain)
- Windows 10/11 SDK (Tauri 用)

### ビルド手順

```powershell
# 依存関係のインストール
pnpm install

# テストの実行
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml

# 開発モード
pnpm dev

# プロダクションビルド
pnpm build
pnpm tauri build
```

インストーラーは `src-tauri/target/release/bundle/` に出力されます。

---

## 技術スタック

- **フロントエンド**: React 18.3 + TypeScript + Vite 7 + Tailwind CSS 4
- **バックエンド**: Rust + Tauri 2.8
- **多言語対応**: i18next + react-i18next
- **テスト**: Vitest (ユニット)、Playwright (E2E)、Rust 組み込みテスト

---

## ライセンス

MIT License

OmOswitch は [CCswitch](https://github.com/farion1231/ccswitch) (MIT License) から、特にアトミックな設定書き込みとファイル変更検知の実装パターンについてインスピレーションを得ています。

---

## バージョン履歴

### v0.2.0 (最新)

- プロバイダ管理 UI と CLI
- フォールバックモデル対応のモデル割り当て
- プロバイダごとのカスタム JSON フィールド
- `auth.json` への安全な API キー保存
- プロバイダからのモデルリスト取得
- 差分検知と適用状態 UI の改善

### v0.1.0

- 初回リリース
- プロファイル管理（作成、適用、複製、削除）
- `[opencode]` と `[native]` からのインポート
- 差分検知と取り込み
- バックアップと復元
- 日本語・英語 UI
- システムトレイ統合

---

## サポート

問題や質問については、[GitHub](https://github.com/kfg231/omoswitch/issues) で Issue を開いてください。

**注意**: これは個人プロジェクトのため、サポートや更新はベストエフォートベースで提供され、応答時間や継続性は保証されません。

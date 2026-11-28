# 🤖 test-partner-bot（テスト相手役Bot）

自作Discord Botの動作確認に使う「相手役」専用のBotです。テスト対象のBotと同じテストサーバーに入り、シナリオ（JSON）に書かれた手順どおりに投稿・リアクション・返信を行い、対象Botの応答が来るかどうかまで自動で確認します。

| 項目 | 内容 |
|---|---|
| バージョン | v1.0.0 |
| 状態 | 未デプロイ（シナリオ実行型の CLI ツールで常駐しない） |
| 稼働先 | – |
| 実装 | TypeScript（discord.js 14） |
| 更新履歴 | [CHANGELOG.md](CHANGELOG.md) |

## 📖 概要

ユーザーアカウントの自動化（セルフボット）はDiscordの規約で禁止されているため、このBotは **Developer Portal で作る正規のBotアプリケーション** として動作します。アカウント共有にも該当しません。

## ✨ 機能

- シナリオJSONのステップを順番に実行
  - `send` 投稿 / `reply` 返信 / `edit` 編集 / `delete` 削除
  - `react` 指定メッセージへリアクション / `reactLatest` 最新メッセージへリアクション
  - `expectMessage` 対象Botからの応答待ち（送信者ID・含む文字列・正規表現で絞り込み、タイムアウト付き）
  - `wait` 待機
- 失敗したステップで停止し、終了コード 1 を返す（CIや手元の確認に使える）
- 投稿したメッセージを `saveAs` 名で保存し、後続ステップから参照できる

## 🚀 セットアップ

### 準備

1. [Discord Developer Portal](https://discord.com/developers/applications) で **2つ目のアプリ** を作成し、Botを追加する
2. Bot の **Privileged Gateway Intents** で **MESSAGE CONTENT INTENT** を有効化する（`expectMessage` の本文マッチに必要）
3. OAuth2 → URL Generator で `bot` スコープを選び、権限に View Channel / Send Messages / Read Message History / Add Reactions を付けて、テストサーバーに招待する
4. テスト対象のBotも同じテストサーバーに入れておく
5. `.env.example` を `.env` にコピーし、相手役Botのトークンを入れる

### 環境変数

| 変数 | 必須 | 内容 |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | 相手役Botのトークン（Discord Developer Portal で作った2つ目のアプリのBotトークン） |

### 使い方

```bash
npm install
npm run build
node dist/index.js scenarios/smoke.json
```

シナリオの `channelId` はテストチャンネルのID、`expectMessage` の `fromUserId` はテスト対象BotのユーザーIDに書き換えてください。サンプルが2つ入っています。

- `scenarios/smoke.json` — 投稿→リアクション→編集の基本動作
- `scenarios/expect-reply.json` — テキストを送り、対象Botの応答を待ってリアクションする

終了コードは、全ステップ成功で 0、ステップ失敗で 1、引数不足・トークン未設定・シナリオ不正などの実行前の失敗で 2 です。

## 🧪 テスト

```bash
npm test        # 型チェック付きで単体テスト（Discordには接続しません）
npm run typecheck
```

## 📁 ファイル構成

- `src/index.ts` — 起動（シナリオを読み込んで実行）
- `src/client.ts` — Discord クライアント
- `src/runner.ts` — シナリオ実行エンジン
- `src/scenario.ts` — シナリオ（JSON）の型定義と検証
- `src/watchdog.ts` — READY ウォッチドッグ
- `test/` — 単体テスト
- `scenarios/` — サンプルシナリオ

## 📋 仕様メモ

### シナリオの書式

```jsonc
{
  "name": "シナリオ名",
  "channelId": "既定のチャンネルID",
  "steps": [
    { "action": "send", "content": "送る文面", "saveAs": "m1" },
    { "action": "react", "to": "m1", "emoji": "👍" },
    { "action": "expectMessage", "fromUserId": "対象BotのID", "contains": "含まれるはずの文字列", "timeoutMs": 10000, "saveAs": "r1" },
    { "action": "reply", "to": "r1", "content": "返信する文面" },
    { "action": "wait", "ms": 1000 }
  ]
}
```

`to` / `target` には `saveAs` 名のほか、生のメッセージIDも指定できます。

## ⚠️ 注意

- **スラッシュコマンドは送れません。** Botアカウントは他のBotのスラッシュコマンドを実行できないため、対象Botがスラッシュコマンドのみの場合は、プレフィックス形式やメンション起動などテキスト起点の導線でテストしてください
- **対象Botが「他のBotを無視」する実装だと発火しません。** Bot同士のループ防止でよくある判定です。その場合はテスト時だけ判定を緩めるか、ハンドラの単体テストと併用してください
- 対象Botの応答が Embed のみの場合は本文が空になるため、`expectMessage` の `contains` / `pattern` が一致しません（送信者IDだけでの判定は可能です）

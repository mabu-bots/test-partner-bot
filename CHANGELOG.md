# 変更履歴

## v1.0.0（2026-11-28）

### 追加

- テスト相手役Botをゼロから再実装した（全リポジトリ再作成プログラムの一環）。機能・仕様は旧実装から漏れなく引き継いだ
  - シナリオ（JSON）のステップ実行: `send` / `reply` / `edit` / `delete` / `react` / `reactLatest` / `expectMessage` / `wait` の8アクション
  - `expectMessage` は送信者ID・含む文字列・正規表現で絞り込み可能。マッチしたメッセージを消費する仕様と、`fromUserId` 省略時の自著者既定除外で偽陽性を防ぐ
  - シナリオ検証（parseScenario）: 項目の型に加え、タイマー値の setTimeout 範囲チェックと `pattern` の正規表現妥当性を読み込み時に検証
  - READY ウォッチドッグ（READY が120秒来なければプロセス終了し、再起動は pm2 に委ねる）
  - サンプルシナリオ2件（smoke / expect-reply）
  - 単体テスト32件（Discord には接続しない）
- 統一開発フローの基盤を追加した（Issue テンプレート、PR テンプレート、CONTRIBUTING、CI）

### 変更

- バージョンを 1.0.0 にリセットした（旧実装も 1.0.0 のため実質の変更なし。再構築の節目として改めて開始）

### 削除

- 未使用の devDependency `tsx` を削除した（scripts・CI のどこからも参照されていなかった）

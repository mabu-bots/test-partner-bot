#!/usr/bin/env bash
# test-partner-bot 一括ビルド: 依存解決 → ビルド → テスト
set -euo pipefail
cd "$(dirname "$0")"
npm install
npm run build
npm test
echo "ビルドとテストが完了しました。起動: npm start (.env が必要です)"

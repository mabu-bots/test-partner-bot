import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DiscordPartnerClient } from "./client.js";
import { parseScenario, type Scenario } from "./scenario.js";
import { runScenario } from "./runner.js";

// ==========================================
// 📄 .env 読み込み
// ==========================================

// 📄 .env ファイルを読み、未設定の環境変数だけを設定する
// （既に環境にある値を上書きしない。値の前後の引用符は取り除く）
function loadEnvFile(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    // .env が無ければ何もしない（環境変数が直接渡されている想定）
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (process.env[key] === undefined) {
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

// ==========================================
// 🚀 エントリーポイント
// ==========================================

// 🚀 シナリオを読み込んで実行し、終了コードを返す
// 使い方: node dist/index.js <scenario.json>
// 終了コード: 0 = 全ステップ成功 / 1 = ステップ失敗 / 2 = 実行前の失敗
async function main(): Promise<number> {
  loadEnvFile(resolve(process.cwd(), ".env"));

  const scenarioPath = process.argv[2];
  if (!scenarioPath) {
    console.error("使い方: node dist/index.js <scenario.json>");
    return 2;
  }
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error(
      "DISCORD_TOKEN が未設定です（.env に相手役Botのトークンを入れてください）",
    );
    return 2;
  }

  let scenario: Scenario;
  try {
    const raw: unknown = JSON.parse(readFileSync(resolve(scenarioPath), "utf8"));
    scenario = parseScenario(raw);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  const client = new DiscordPartnerClient();
  try {
    const selfId = await client.login(token);
    console.log(`相手役Botとしてログインしました (id=${selfId})`);
    console.log(
      `シナリオ「${scenario.name}」を開始します（${scenario.steps.length} ステップ）`,
    );
    const summary = await runScenario(client, scenario, {
      selfId,
      log: (line) => console.log(line),
    });
    console.log(
      `結果: ${summary.passed} 成功 / ${summary.failed} 失敗（全 ${scenario.steps.length} ステップ中 ${summary.results.length} 実行）`,
    );
    const allDone = summary.results.length === scenario.steps.length;
    return summary.failed === 0 && allDone ? 0 : 1;
  } finally {
    await client.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  });

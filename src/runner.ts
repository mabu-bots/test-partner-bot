import type { Scenario, Step } from "./scenario.js";

// ==========================================
// 🔌 クライアント抽象化
// ==========================================
// 実行エンジンが必要とする Discord 操作の最小インターフェース。
// 実装は client.ts（discord.js）。テストではフェイクに差し替える。

// 📩 受信メッセージのうち、エンジンが判定に使う項目だけを抜き出した形
export interface IncomingMessage {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
}

export interface PartnerClient {
  sendMessage(channelId: string, content: string): Promise<{ id: string }>;
  replyTo(
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<{ id: string }>;
  editMessage(
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<void>;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  addReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void>;
  latestMessageId(channelId: string): Promise<string | null>;
  // ⏳ 条件に合う受信メッセージを待つ。タイムアウトしたら null を返す
  waitForMessage(
    filter: (msg: IncomingMessage) => boolean,
    timeoutMs: number,
  ): Promise<IncomingMessage | null>;
}

// ==========================================
// 🏃 シナリオ実行エンジン
// ==========================================
// ステップを先頭から順に実行し、1件でも失敗したらそこで止める
// （後続ステップは前提となる状態が崩れているため実行しない）。

// 📋 ステップ1件の実行結果
export interface StepResult {
  index: number;
  action: string;
  ok: boolean;
  detail: string;
}

// 📊 シナリオ全体の集計
export interface RunSummary {
  name: string;
  results: StepResult[];
  passed: number;
  failed: number;
}

export interface RunnerOptions {
  // ⏱️ 待機の実装（テストでは差し替えて実時間を待たない）
  sleep?: (ms: number) => Promise<void>;
  // 🖨️ 進捗ログの出力先
  log?: (line: string) => void;
  // ⏳ expectMessage で timeoutMs を省略したときの既定値
  defaultTimeoutMs?: number;
  // 🪪 相手役Bot自身のユーザーID。expectMessage で fromUserId を
  // 省略した場合、自分の投稿を「対象Botの応答」と誤認しないよう
  // 自著者を既定で除外するために使う
  selfId?: string;
}

// ⏳ expectMessage の既定タイムアウト（10,000ms）
const DEFAULT_TIMEOUT_MS = 10_000;

// 😴 実際に眠る sleep の既定実装
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 🏃 シナリオを実行して集計を返す
export async function runScenario(
  client: PartnerClient,
  scenario: Scenario,
  options: RunnerOptions = {},
): Promise<RunSummary> {
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? (() => {});
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const selfId = options.selfId;

  // 💾 saveAs で名前を付けたメッセージ（名前 → 参照）
  const savedRefs = new Map<string, { id: string; channelId: string }>();
  const results: StepResult[] = [];

  // 🔗 参照（saveAs 名 or 生のメッセージID）を実参照へ解決する。
  // saveAs 名でなければ生のメッセージIDとみなし、チャンネルは
  // シナリオの既定チャンネルを使う
  const resolveRef = (ref: string): { id: string; channelId: string } => {
    const hit = savedRefs.get(ref);
    return hit ?? { id: ref, channelId: scenario.channelId };
  };

  // 💾 送信結果を saveAs 名で覚える
  const remember = (
    saveAs: string | undefined,
    id: string,
    channelId: string,
  ): void => {
    if (saveAs) savedRefs.set(saveAs, { id, channelId });
  };

  // 🪜 ステップを1件実行し、結果の詳細文を返す。失敗時は例外
  const executeStep = async (step: Step): Promise<string> => {
    switch (step.action) {
      case "wait": {
        await sleep(step.ms);
        return `${step.ms}ms 待機`;
      }
      case "send": {
        const channelId = step.channelId ?? scenario.channelId;
        const sent = await client.sendMessage(channelId, step.content);
        remember(step.saveAs, sent.id, channelId);
        return `送信しました (id=${sent.id})`;
      }
      case "reply": {
        const target = resolveRef(step.to);
        const sent = await client.replyTo(
          target.channelId,
          target.id,
          step.content,
        );
        remember(step.saveAs, sent.id, target.channelId);
        return `返信しました (id=${sent.id})`;
      }
      case "edit": {
        const target = resolveRef(step.target);
        await client.editMessage(target.channelId, target.id, step.content);
        return `編集しました (id=${target.id})`;
      }
      case "delete": {
        const target = resolveRef(step.target);
        await client.deleteMessage(target.channelId, target.id);
        return `削除しました (id=${target.id})`;
      }
      case "react": {
        const target = resolveRef(step.to);
        await client.addReaction(target.channelId, target.id, step.emoji);
        return `${step.emoji} を付けました (id=${target.id})`;
      }
      case "reactLatest": {
        const channelId = step.channelId ?? scenario.channelId;
        const latestId = await client.latestMessageId(channelId);
        if (latestId === null) {
          throw new Error("チャンネルにメッセージがありません");
        }
        await client.addReaction(channelId, latestId, step.emoji);
        return `${step.emoji} を最新メッセージに付けました (id=${latestId})`;
      }
      case "expectMessage": {
        const channelId = step.channelId ?? scenario.channelId;
        const timeoutMs = step.timeoutMs ?? defaultTimeoutMs;
        const pattern = step.pattern ? new RegExp(step.pattern) : null;
        const found = await client.waitForMessage((msg) => {
          if (msg.channelId !== channelId) return false;
          if (step.fromUserId) {
            // 送信者を明示した場合はその指定をそのまま優先する
            if (msg.authorId !== step.fromUserId) return false;
          } else if (selfId && msg.authorId === selfId) {
            // 🙅 送信者省略時は自分の投稿を既定で除外する（自分の
            // send に自分でマッチして成功する偽陽性を防ぐ）
            return false;
          }
          if (step.contains && !msg.content.includes(step.contains)) {
            return false;
          }
          if (pattern && !pattern.test(msg.content)) return false;
          return true;
        }, timeoutMs);
        if (found === null) {
          throw new Error(
            `条件に合うメッセージが ${timeoutMs}ms 以内に来ませんでした`,
          );
        }
        remember(step.saveAs, found.id, found.channelId);
        return `期待メッセージを受信 (id=${found.id}, author=${found.authorId})`;
      }
    }
  };

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    try {
      const detail = await executeStep(step);
      results.push({ index: i, action: step.action, ok: true, detail });
      log(`[ok] #${i} ${step.action}: ${detail}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      results.push({ index: i, action: step.action, ok: false, detail });
      log(`[ng] #${i} ${step.action}: ${detail}`);
      // 🛑 失敗したステップで打ち切る
      break;
    }
  }

  const passed = results.filter((r) => r.ok).length;
  return {
    name: scenario.name,
    results,
    passed,
    failed: results.length - passed,
  };
}

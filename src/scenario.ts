// ==========================================
// 📝 シナリオ定義と検証
// ==========================================
// テストシナリオ（JSON）の型定義と、読み込んだ JSON が実行可能な
// シナリオかどうかを検証する parseScenario を置く。

// 🎬 1ステップ分の手順。action ごとに必要な項目が異なる判別共用体
export type Step =
  | { action: "wait"; ms: number }
  | { action: "send"; content: string; channelId?: string; saveAs?: string }
  | { action: "reply"; to: string; content: string; saveAs?: string }
  | { action: "edit"; target: string; content: string }
  | { action: "delete"; target: string }
  | { action: "react"; to: string; emoji: string }
  | { action: "reactLatest"; emoji: string; channelId?: string }
  | {
      action: "expectMessage";
      fromUserId?: string;
      contains?: string;
      pattern?: string;
      timeoutMs?: number;
      channelId?: string;
      saveAs?: string;
    };

// 📋 シナリオ全体。channelId はステップ側で省略したときの既定チャンネル
export interface Scenario {
  name: string;
  channelId: string;
  steps: Step[];
}

// 🎬 受け付けるアクション名の一覧（検証メッセージにも使う）
const KNOWN_ACTIONS: readonly string[] = [
  "wait",
  "send",
  "reply",
  "edit",
  "delete",
  "react",
  "reactLatest",
  "expectMessage",
];

// ⏱️ setTimeout に渡せる最大値（2^31 - 1 ms）。これを超える値を渡すと
// Node は約1msに丸めてしまうため、「長く待つ」つもりが即座に終わる
// 静かな誤動作になる。検証の段階で範囲外として弾く
const TIMER_MAX_MS = 2_147_483_647;

// 🧾 値がプレーンなオブジェクト（配列・null でない）かどうか
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// 🔤 必須文字列: 空でない文字列でなければエラーを積む
function requireString(
  obj: Record<string, unknown>,
  key: string,
  errors: string[],
  where: string,
): void {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${where}: "${key}" は空でない文字列が必要です`);
  }
}

// 🔤 任意文字列: 指定があるなら文字列でなければならない
function optionalString(
  obj: Record<string, unknown>,
  key: string,
  errors: string[],
  where: string,
): void {
  if (obj[key] !== undefined && typeof obj[key] !== "string") {
    errors.push(`${where}: "${key}" は文字列で指定してください`);
  }
}

// ⏱️ タイマー値（ms）が setTimeout の扱える範囲にあるか
function checkTimerValue(
  value: number,
  key: string,
  errors: string[],
  where: string,
): void {
  if (value < 0 || value > TIMER_MAX_MS) {
    errors.push(
      `${where}: "${key}" は 0 以上 ${TIMER_MAX_MS} 以下で指定してください`,
    );
  }
}

// 🔢 必須数値: 有限な数値でなければならず、タイマー範囲も確認する
function requireTimerNumber(
  obj: Record<string, unknown>,
  key: string,
  errors: string[],
  where: string,
): void {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${where}: "${key}" は数値が必要です`);
    return;
  }
  checkTimerValue(value, key, errors, where);
}

// 🔢 任意数値: 指定があるなら有限な数値で、タイマー範囲も確認する
function optionalTimerNumber(
  obj: Record<string, unknown>,
  key: string,
  errors: string[],
  where: string,
): void {
  const value = obj[key];
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${where}: "${key}" は数値で指定してください`);
    return;
  }
  checkTimerValue(value, key, errors, where);
}

// 🪜 ステップ1件分の項目を、そのアクションの要件に照らして検証する
function validateStep(raw: unknown, index: number, errors: string[]): void {
  const where = `steps[${index}]`;
  if (!isPlainObject(raw)) {
    errors.push(`${where}: オブジェクトである必要があります`);
    return;
  }
  const action = raw.action;
  if (typeof action !== "string" || !KNOWN_ACTIONS.includes(action)) {
    errors.push(`${where}: "action" が不正です（${KNOWN_ACTIONS.join(" / ")}）`);
    return;
  }
  switch (action) {
    case "wait":
      requireTimerNumber(raw, "ms", errors, where);
      break;
    case "send":
      requireString(raw, "content", errors, where);
      optionalString(raw, "channelId", errors, where);
      optionalString(raw, "saveAs", errors, where);
      break;
    case "reply":
      requireString(raw, "to", errors, where);
      requireString(raw, "content", errors, where);
      optionalString(raw, "saveAs", errors, where);
      break;
    case "edit":
      requireString(raw, "target", errors, where);
      requireString(raw, "content", errors, where);
      break;
    case "delete":
      requireString(raw, "target", errors, where);
      break;
    case "react":
      requireString(raw, "to", errors, where);
      requireString(raw, "emoji", errors, where);
      break;
    case "reactLatest":
      requireString(raw, "emoji", errors, where);
      optionalString(raw, "channelId", errors, where);
      break;
    case "expectMessage":
      optionalString(raw, "fromUserId", errors, where);
      optionalString(raw, "contains", errors, where);
      optionalString(raw, "pattern", errors, where);
      optionalTimerNumber(raw, "timeoutMs", errors, where);
      optionalString(raw, "channelId", errors, where);
      optionalString(raw, "saveAs", errors, where);
      // 正規表現は実行時ではなく読み込み時に壊れていることを知らせる
      if (typeof raw.pattern === "string") {
        try {
          new RegExp(raw.pattern);
        } catch {
          errors.push(`${where}: "pattern" は正規表現として不正です`);
        }
      }
      break;
  }
}

// ✅ JSON を検証して Scenario として返す
// 不正な場合は見つけた問題をすべて列挙した例外を投げる
export function parseScenario(data: unknown): Scenario {
  if (!isPlainObject(data)) {
    throw new Error("シナリオはJSONオブジェクトである必要があります");
  }
  const errors: string[] = [];
  if (typeof data.name !== "string" || data.name.length === 0) {
    errors.push(`"name" は空でない文字列が必要です`);
  }
  if (typeof data.channelId !== "string" || data.channelId.length === 0) {
    errors.push(`"channelId" は空でない文字列が必要です`);
  }
  if (!Array.isArray(data.steps) || data.steps.length === 0) {
    errors.push(`"steps" は1件以上の配列が必要です`);
    throw new Error(`シナリオが不正です:\n- ${errors.join("\n- ")}`);
  }
  data.steps.forEach((raw, i) => validateStep(raw, i, errors));
  if (errors.length > 0) {
    throw new Error(`シナリオが不正です:\n- ${errors.join("\n- ")}`);
  }
  return data as unknown as Scenario;
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScenario } from "../src/scenario.js";
import { DiscordPartnerClient } from "../src/client.js";
import {
  runScenario,
  type IncomingMessage,
  type PartnerClient,
} from "../src/runner.js";

// ==========================================
// 🎭 フェイククライアント
// ==========================================
// Discord へ接続せず、呼び出しを記録し、受信メッセージを疑似的に返す。
// waitForMessage は実クライアントと同じ消費セマンティクスにする
// （マッチしたメッセージは取り除かれ、再利用できない）。

class FakeClient implements PartnerClient {
  sent: { channelId: string; content: string; id: string }[] = [];
  replies: { channelId: string; messageId: string; content: string }[] = [];
  edits: { messageId: string; content: string }[] = [];
  deletes: string[] = [];
  reactions: { messageId: string; emoji: string }[] = [];
  incoming: IncomingMessage[] = [];
  latestId: string | null = "latest-1";
  private counter = 0;

  async sendMessage(channelId: string, content: string) {
    const id = `sent-${++this.counter}`;
    this.sent.push({ channelId, content, id });
    return { id };
  }
  async replyTo(channelId: string, messageId: string, content: string) {
    const id = `reply-${++this.counter}`;
    this.replies.push({ channelId, messageId, content });
    return { id };
  }
  async editMessage(_channelId: string, messageId: string, content: string) {
    this.edits.push({ messageId, content });
  }
  async deleteMessage(_channelId: string, messageId: string) {
    this.deletes.push(messageId);
  }
  async addReaction(_channelId: string, messageId: string, emoji: string) {
    this.reactions.push({ messageId, emoji });
  }
  async latestMessageId() {
    return this.latestId;
  }
  async waitForMessage(
    filter: (msg: IncomingMessage) => boolean,
    _timeoutMs: number,
  ) {
    const idx = this.incoming.findIndex((m) => filter(m));
    if (idx < 0) return null;
    const [hit] = this.incoming.splice(idx, 1);
    return hit;
  }
}

// 😴 テストでは実時間を待たない
const noSleep = async () => {};

// ==========================================
// ✅ parseScenario（シナリオ検証）
// ==========================================

test("parseScenario: 正常なシナリオを受け付ける", () => {
  const s = parseScenario({
    name: "smoke",
    channelId: "111",
    steps: [{ action: "send", content: "hi" }],
  });
  assert.equal(s.name, "smoke");
  assert.equal(s.steps.length, 1);
});

test("parseScenario: name が無いとエラー", () => {
  assert.throws(
    () => parseScenario({ channelId: "1", steps: [{ action: "wait", ms: 1 }] }),
    /name/,
  );
});

test("parseScenario: channelId が無いとエラー", () => {
  assert.throws(
    () => parseScenario({ name: "x", steps: [{ action: "wait", ms: 1 }] }),
    /channelId/,
  );
});

test("parseScenario: steps が空だとエラー", () => {
  assert.throws(
    () => parseScenario({ name: "x", channelId: "1", steps: [] }),
    /steps/,
  );
});

test("parseScenario: 未知の action をエラーにする", () => {
  assert.throws(
    () =>
      parseScenario({
        name: "x",
        channelId: "1",
        steps: [{ action: "explode" }],
      }),
    /action/,
  );
});

test("parseScenario: send に content が無いとエラー", () => {
  assert.throws(
    () =>
      parseScenario({ name: "x", channelId: "1", steps: [{ action: "send" }] }),
    /content/,
  );
});

test("parseScenario: expectMessage の pattern が正規表現として不正だとエラー", () => {
  assert.throws(
    () =>
      parseScenario({
        name: "x",
        channelId: "1",
        steps: [{ action: "expectMessage", pattern: "(" }],
      }),
    /pattern/,
  );
});

test("parseScenario: オブジェクトでない入力をエラーにする", () => {
  assert.throws(() => parseScenario("nope"), /オブジェクト/);
});

// ==========================================
// ⏱️ 数値の範囲検証（回帰）
// ==========================================
// setTimeout の上限を超える値は Node が約1msに丸めてしまうため、
// 検証で弾く（wait が即通過する／expectMessage が即タイムアウトする
// 静かな誤動作の防止）。

test("parseScenario: wait の ms が負だとエラー", () => {
  assert.throws(
    () =>
      parseScenario({
        name: "x",
        channelId: "1",
        steps: [{ action: "wait", ms: -1 }],
      }),
    /ms/,
  );
});

test("parseScenario: wait の ms が setTimeout 上限を超えるとエラー", () => {
  assert.throws(
    () =>
      parseScenario({
        name: "x",
        channelId: "1",
        steps: [{ action: "wait", ms: 2_147_483_648 }],
      }),
    /ms/,
  );
});

test("parseScenario: expectMessage の timeoutMs が有限でないとエラー", () => {
  assert.throws(
    () =>
      parseScenario({
        name: "x",
        channelId: "1",
        steps: [
          { action: "expectMessage", timeoutMs: Number.POSITIVE_INFINITY },
        ],
      }),
    /timeoutMs/,
  );
});

test("parseScenario: expectMessage の timeoutMs が負または上限超えだとエラー", () => {
  assert.throws(
    () =>
      parseScenario({
        name: "x",
        channelId: "1",
        steps: [{ action: "expectMessage", timeoutMs: -5 }],
      }),
    /timeoutMs/,
  );
  assert.throws(
    () =>
      parseScenario({
        name: "x",
        channelId: "1",
        steps: [{ action: "expectMessage", timeoutMs: 2_147_483_648 }],
      }),
    /timeoutMs/,
  );
});

// ==========================================
// 🏃 runScenario（実行エンジン）
// ==========================================

test("runScenario: send と react が saveAs 参照でつながる", async () => {
  const fake = new FakeClient();
  const summary = await runScenario(
    fake,
    {
      name: "t",
      channelId: "111",
      steps: [
        { action: "send", content: "hello", saveAs: "m1" },
        { action: "react", to: "m1", emoji: "👍" },
      ],
    },
    { sleep: noSleep },
  );
  assert.equal(summary.failed, 0);
  assert.equal(fake.sent[0].content, "hello");
  assert.deepEqual(fake.reactions, [{ messageId: "sent-1", emoji: "👍" }]);
});

test("runScenario: send の channelId 上書きが使われる", async () => {
  const fake = new FakeClient();
  const summary = await runScenario(
    fake,
    {
      name: "t",
      channelId: "111",
      steps: [{ action: "send", content: "hi", channelId: "222" }],
    },
    { sleep: noSleep },
  );
  assert.equal(summary.failed, 0);
  assert.equal(fake.sent[0].channelId, "222");
});

test("runScenario: 生のメッセージIDへの reply は既定チャンネルで解決される", async () => {
  const fake = new FakeClient();
  const summary = await runScenario(
    fake,
    {
      name: "t",
      channelId: "111",
      steps: [{ action: "reply", to: "raw-id-123", content: "返信" }],
    },
    { sleep: noSleep },
  );
  assert.equal(summary.failed, 0);
  assert.deepEqual(fake.replies, [
    { channelId: "111", messageId: "raw-id-123", content: "返信" },
  ]);
});

test("runScenario: expectMessage が条件に合う受信を拾う", async () => {
  const fake = new FakeClient();
  fake.incoming = [
    { id: "a", channelId: "111", authorId: "999", content: "関係ない" },
    {
      id: "b",
      channelId: "111",
      authorId: "target-bot",
      content: "お題: 好きな食べ物",
    },
  ];
  const summary = await runScenario(
    fake,
    {
      name: "t",
      channelId: "111",
      steps: [
        {
          action: "expectMessage",
          fromUserId: "target-bot",
          contains: "お題",
          saveAs: "r1",
        },
        { action: "reply", to: "r1", content: "ラーメン" },
      ],
    },
    { sleep: noSleep },
  );
  assert.equal(summary.failed, 0);
  assert.deepEqual(fake.replies, [
    { channelId: "111", messageId: "b", content: "ラーメン" },
  ]);
});

test("runScenario: expectMessage は別チャンネルのメッセージを拾わない", async () => {
  const fake = new FakeClient();
  fake.incoming = [
    { id: "a", channelId: "999", authorId: "target-bot", content: "お題: 別ch" },
  ];
  const summary = await runScenario(
    fake,
    {
      name: "t",
      channelId: "111",
      steps: [{ action: "expectMessage", contains: "お題", timeoutMs: 10 }],
    },
    { sleep: noSleep },
  );
  assert.equal(summary.failed, 1);
});

test("runScenario: expectMessage が来なければ失敗し、後続ステップを止める", async () => {
  const fake = new FakeClient();
  const summary = await runScenario(
    fake,
    {
      name: "t",
      channelId: "111",
      steps: [
        { action: "expectMessage", contains: "来ないはず", timeoutMs: 10 },
        { action: "send", content: "実行されない" },
      ],
    },
    { sleep: noSleep },
  );
  assert.equal(summary.failed, 1);
  assert.equal(summary.results.length, 1);
  assert.equal(fake.sent.length, 0);
});

test("runScenario: expectMessage は pattern（正規表現）でも絞れる", async () => {
  const fake = new FakeClient();
  fake.incoming = [
    { id: "a", channelId: "111", authorId: "x", content: "残り 42 秒" },
  ];
  const summary = await runScenario(
    fake,
    {
      name: "t",
      channelId: "111",
      steps: [{ action: "expectMessage", pattern: "残り \\d+ 秒" }],
    },
    { sleep: noSleep },
  );
  assert.equal(summary.failed, 0);
});

test("runScenario: reactLatest は最新メッセージに付ける", async () => {
  const fake = new FakeClient();
  const summary = await runScenario(
    fake,
    {
      name: "t",
      channelId: "111",
      steps: [{ action: "reactLatest", emoji: "⭐" }],
    },
    { sleep: noSleep },
  );
  assert.equal(summary.failed, 0);
  assert.deepEqual(fake.reactions, [{ messageId: "latest-1", emoji: "⭐" }]);
});

test("runScenario: reactLatest はメッセージが無いチャンネルで失敗する", async () => {
  const fake = new FakeClient();
  fake.latestId = null;
  const summary = await runScenario(
    fake,
    {
      name: "t",
      channelId: "111",
      steps: [{ action: "reactLatest", emoji: "⭐" }],
    },
    { sleep: noSleep },
  );
  assert.equal(summary.failed, 1);
});

test("runScenario: edit と delete が saveAs 参照で動く", async () => {
  const fake = new FakeClient();
  const summary = await runScenario(
    fake,
    {
      name: "t",
      channelId: "111",
      steps: [
        { action: "send", content: "before", saveAs: "m1" },
        { action: "edit", target: "m1", content: "after" },
        { action: "delete", target: "m1" },
      ],
    },
    { sleep: noSleep },
  );
  assert.equal(summary.failed, 0);
  assert.deepEqual(fake.edits, [{ messageId: "sent-1", content: "after" }]);
  assert.deepEqual(fake.deletes, ["sent-1"]);
});

test("runScenario: wait ステップが sleep を使う", async () => {
  const fake = new FakeClient();
  let slept = 0;
  const summary = await runScenario(
    fake,
    {
      name: "t",
      channelId: "111",
      steps: [{ action: "wait", ms: 500 }],
    },
    {
      sleep: async (ms) => {
        slept = ms;
      },
    },
  );
  assert.equal(summary.failed, 0);
  assert.equal(slept, 500);
});

// ==========================================
// 🔄 expectMessage の消費セマンティクス（回帰）
// ==========================================
// マッチしたメッセージは消費され、後続の expectMessage が同じ
// メッセージに再マッチしない（旧実装の偽陽性の再発防止）。

test("runScenario: 同じ条件の expectMessage は同じメッセージを再利用しない", async () => {
  const fake = new FakeClient();
  fake.incoming = [
    { id: "only", channelId: "111", authorId: "target-bot", content: "応答です" },
  ];
  const summary = await runScenario(
    fake,
    {
      name: "t",
      channelId: "111",
      steps: [
        { action: "expectMessage", contains: "応答" },
        { action: "expectMessage", contains: "応答" },
      ],
    },
    { sleep: noSleep },
  );
  // 1件目は成功、2件目は新しい応答が無いので失敗する
  assert.equal(summary.passed, 1);
  assert.equal(summary.failed, 1);
});

test("DiscordPartnerClient: waitForMessage はマッチしたメッセージを消費する", async () => {
  const client = new DiscordPartnerClient();
  try {
    const internal = client as unknown as {
      inbox: IncomingMessage[];
      handleMessage: (msg: unknown) => void;
    };
    internal.inbox.push({
      id: "buf-1",
      channelId: "111",
      authorId: "target-bot",
      content: "hello",
    });
    const first = await client.waitForMessage(
      (m) => m.content.includes("hello"),
      100,
    );
    assert.equal(first?.id, "buf-1");
    const second = await client.waitForMessage(
      (m) => m.content.includes("hello"),
      20,
    );
    assert.equal(second, null);

    // waiter 経由で届いたメッセージもバッファに残らないこと
    const pending = client.waitForMessage(
      (m) => m.content.includes("world"),
      100,
    );
    internal.handleMessage({
      id: "live-1",
      channelId: "111",
      author: { id: "target-bot" },
      content: "world",
    });
    assert.equal((await pending)?.id, "live-1");
    const again = await client.waitForMessage(
      (m) => m.content.includes("world"),
      20,
    );
    assert.equal(again, null);
  } finally {
    await client.destroy();
  }
});

// ==========================================
// 🙅 自著者の既定除外（回帰）
// ==========================================

test("runScenario: expectMessage は fromUserId 省略時に自分のメッセージを拾わない", async () => {
  const fake = new FakeClient();
  fake.incoming = [
    { id: "self", channelId: "111", authorId: "self-bot", content: "お題: 自分" },
    { id: "other", channelId: "111", authorId: "target-bot", content: "お題: 相手" },
  ];
  const summary = await runScenario(
    fake,
    {
      name: "t",
      channelId: "111",
      steps: [{ action: "expectMessage", contains: "お題", saveAs: "r1" }],
    },
    { sleep: noSleep, selfId: "self-bot" },
  );
  assert.equal(summary.failed, 0);
  assert.match(summary.results[0].detail, /id=other/);
});

test("runScenario: 自分のメッセージしか無い場合は expectMessage が失敗する", async () => {
  const fake = new FakeClient();
  fake.incoming = [
    { id: "self", channelId: "111", authorId: "self-bot", content: "自分の投稿" },
  ];
  const summary = await runScenario(
    fake,
    {
      name: "t",
      channelId: "111",
      steps: [{ action: "expectMessage", contains: "自分", timeoutMs: 10 }],
    },
    { sleep: noSleep, selfId: "self-bot" },
  );
  assert.equal(summary.failed, 1);
});

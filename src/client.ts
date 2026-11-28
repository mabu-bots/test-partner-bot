import {
  Client,
  GatewayIntentBits,
  type Message,
  type TextChannel,
} from "discord.js";
import type { IncomingMessage, PartnerClient } from "./runner.js";
import { attachReadyWatchdog } from "./watchdog.js";

// ==========================================
// 🤖 Discord クライアント実装
// ==========================================
// PartnerClient の discord.js 実装。受信メッセージはバッファに貯め、
// waitForMessage は「バッファ → 新規受信」の順に条件を探す。
// マッチしたメッセージは消費され、同じメッセージには二度と
// マッチしない（連続する expectMessage が同じ応答を使い回して
// 偽陽性になるのを防ぐ）。

// 📥 受信バッファの上限件数。これを超えた分は古いものから捨てる
const BUFFER_LIMIT = 200;

// ⏳ 待機中のメッセージ待ち1件分
interface PendingWaiter {
  filter: (msg: IncomingMessage) => boolean;
  resolve: (msg: IncomingMessage | null) => void;
  timer: NodeJS.Timeout;
}

export class DiscordPartnerClient implements PartnerClient {
  private readonly client: Client;
  // 📥 受信メッセージのバッファ（到着順）
  private inbox: IncomingMessage[] = [];
  // ⏳ 現在待機中のメッセージ待ち
  private waiters = new Set<PendingWaiter>();

  // 🤖 クライアントを生成し、受信ハンドラとウォッチドッグを取り付ける
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
      ],
    });
    // 🛡️ READY が来ないサイレント停滞を検知して終了する（watchdog.ts）
    attachReadyWatchdog(this.client);
    this.client.on("messageCreate", (msg) => this.handleMessage(msg));
  }

  // 🔑 ログインし、相手役Bot自身のユーザーIDを返す
  async login(token: string): Promise<string> {
    await this.client.login(token);
    const user = this.client.user;
    if (!user) {
      throw new Error("ログインしましたがユーザー情報を取得できませんでした");
    }
    return user.id;
  }

  // 🧹 クライアントを破棄する
  async destroy(): Promise<void> {
    await this.client.destroy();
  }

  // 📩 受信メッセージをバッファへ貯め、待機中の条件と照合する
  private handleMessage(msg: Message): void {
    const incoming: IncomingMessage = {
      id: msg.id,
      channelId: msg.channelId,
      authorId: msg.author.id,
      content: msg.content ?? "",
    };
    this.inbox.push(incoming);
    if (this.inbox.length > BUFFER_LIMIT) {
      this.inbox.splice(0, this.inbox.length - BUFFER_LIMIT);
    }
    for (const waiter of [...this.waiters]) {
      if (!waiter.filter(incoming)) continue;
      this.waiters.delete(waiter);
      clearTimeout(waiter.timer);
      // 🔄 消費: マッチしたメッセージはバッファからも取り除く
      const idx = this.inbox.indexOf(incoming);
      if (idx >= 0) this.inbox.splice(idx, 1);
      waiter.resolve(incoming);
      break;
    }
  }

  // 📺 チャンネルIDからテキストチャンネルを取得する
  private async fetchTextChannel(channelId: string): Promise<TextChannel> {
    const ch = await this.client.channels.fetch(channelId);
    if (!ch || !("send" in ch)) {
      throw new Error(
        `チャンネル ${channelId} が見つからないか、テキストチャンネルではありません`,
      );
    }
    return ch as TextChannel;
  }

  // 💬 メッセージを送信し、送信済みメッセージのIDを返す
  async sendMessage(
    channelId: string,
    content: string,
  ): Promise<{ id: string }> {
    const ch = await this.fetchTextChannel(channelId);
    const sent = await ch.send(content);
    return { id: sent.id };
  }

  // ↩️ 指定メッセージへ返信し、返信メッセージのIDを返す
  async replyTo(
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<{ id: string }> {
    const ch = await this.fetchTextChannel(channelId);
    const target = await ch.messages.fetch(messageId);
    const sent = await target.reply(content);
    return { id: sent.id };
  }

  // ✏️ 指定メッセージの内容を編集する
  async editMessage(
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<void> {
    const ch = await this.fetchTextChannel(channelId);
    const target = await ch.messages.fetch(messageId);
    await target.edit(content);
  }

  // 🗑️ 指定メッセージを削除する
  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    const ch = await this.fetchTextChannel(channelId);
    const target = await ch.messages.fetch(messageId);
    await target.delete();
  }

  // 😀 指定メッセージにリアクションを付ける
  async addReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    const ch = await this.fetchTextChannel(channelId);
    const target = await ch.messages.fetch(messageId);
    await target.react(emoji);
  }

  // 🆕 チャンネルの最新メッセージのIDを返す（1件も無ければ null）
  async latestMessageId(channelId: string): Promise<string | null> {
    const ch = await this.fetchTextChannel(channelId);
    const messages = await ch.messages.fetch({ limit: 1 });
    const first = messages.first();
    return first ? first.id : null;
  }

  // ⏳ 条件に合う受信メッセージを待つ。タイムアウト時は null
  waitForMessage(
    filter: (msg: IncomingMessage) => boolean,
    timeoutMs: number,
  ): Promise<IncomingMessage | null> {
    // まずバッファ内を探す（マッチしたら消費して即返す）
    const bufferedIdx = this.inbox.findIndex((m) => filter(m));
    if (bufferedIdx >= 0) {
      const [hit] = this.inbox.splice(bufferedIdx, 1);
      return Promise.resolve(hit);
    }
    // 無ければ新規受信を待つ
    return new Promise((resolve) => {
      const waiter: PendingWaiter = {
        filter,
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          resolve(null);
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }
}

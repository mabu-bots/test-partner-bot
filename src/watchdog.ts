// ==========================================
// 🛡️ Gateway安全構造（READYウォッチドッグ）
// ==========================================
// ログイン後に READY が来ない「サイレント停滞」を検知し、プロセスを
// 終了させて pm2 に再起動させるための保険。接続自体は生きていて
// ハートビート ACK も返る状態では discord.js の自動再接続が働かない
// 場合があるためのもの（p1228-java の SessionWatchdog と同じ考え方）。
// discord.js は Client を destroy すると同じインスタンスでは再ログイン
// できないため、回復はプロセス再起動に委ねる設計とする。
import type { Client } from "discord.js";

// ⏱️ READY でない状態がこの時間続いたら停滞とみなす（120,000ms = 2分）
export const NOT_READY_LIMIT_MS = 120_000;
// 🔁 ウォッチドッグの確認間隔（30,000ms = 30秒）
export const WATCHDOG_INTERVAL_MS = 30_000;

// ------------------------------------------
// 🔍 READY 受信状況の追跡（判定ロジック）
// ------------------------------------------

// 🔍 READY の受信状況を追跡し、停滞が制限時間に達したかを判定する
export class ReadyWatchdog {
  // 🕐 READY でなくなった時刻。READY 中は null
  private notReadySince: number | null;

  constructor(now: number) {
    // 起動直後はまだ READY を受けていないので、その時刻から数える
    this.notReadySince = now;
  }

  // 👀 現在の READY 状態を観測させる。READY でなくなった瞬間から数え直す
  observe(isReady: boolean, now: number): void {
    if (isReady) {
      this.notReadySince = null;
    } else if (this.notReadySince === null) {
      this.notReadySince = now;
    }
  }

  // 🔄 発動したら起点をリセットする（終了処理が間に合わない場合の再発防止）
  onFire(now: number): void {
    this.notReadySince = now;
  }

  // ⏰ 停滞が制限時間に達したかどうか
  isExpired(now: number, limitMs: number): boolean {
    return this.notReadySince !== null && now - this.notReadySince >= limitMs;
  }
}

// ------------------------------------------
// 🔌 クライアントへの取り付け
// ------------------------------------------

// 🛡️ クライアントにウォッチドッグを取り付ける。停滞を検知したら
// ログを残してプロセスを終了する（pm2 が再起動する）。
// 戻り値は停止関数（終了処理・テスト用）
export function attachReadyWatchdog(
  client: Client,
  options: {
    limitMs?: number;
    intervalMs?: number;
    log?: (message: string) => void;
    exit?: (code: number) => void;
  } = {},
): () => void {
  const limitMs = options.limitMs ?? NOT_READY_LIMIT_MS;
  const intervalMs = options.intervalMs ?? WATCHDOG_INTERVAL_MS;
  const log = options.log ?? ((message: string) => console.error(message));
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const watchdog = new ReadyWatchdog(Date.now());
  const timer = setInterval(() => {
    const now = Date.now();
    watchdog.observe(client.isReady(), now);
    if (!watchdog.isExpired(now, limitMs)) return;
    log(
      `[watchdog] READY が ${Math.round(limitMs / 1000)} 秒以上来ないためプロセスを終了します (pm2 が再起動します)`,
    );
    watchdog.onFire(now);
    exit(1);
  }, intervalMs);
  // ウォッチドッグ自身がプロセスの終了を妨げないようにする
  timer.unref();
  return () => clearInterval(timer);
}

// ==========================================
// 🛡️ テスト: READYウォッチドッグ
// ==========================================
import assert from "node:assert/strict";
import test from "node:test";
import { ReadyWatchdog } from "../src/watchdog.js";

test("ReadyWatchdog: 起動直後は期限切れでない", () => {
  const watchdog = new ReadyWatchdog(0);
  assert.equal(watchdog.isExpired(119_999, 120_000), false);
});

test("ReadyWatchdog: READY が来ないまま上限を超えたら期限切れ", () => {
  const watchdog = new ReadyWatchdog(0);
  watchdog.observe(false, 60_000);
  assert.equal(watchdog.isExpired(120_000, 120_000), true);
});

test("ReadyWatchdog: READY を受けたら期限切れにならない", () => {
  const watchdog = new ReadyWatchdog(0);
  watchdog.observe(true, 10_000);
  assert.equal(watchdog.isExpired(999_999, 120_000), false);
});

test("ReadyWatchdog: READY 喪失の瞬間から数え直す", () => {
  const watchdog = new ReadyWatchdog(0);
  watchdog.observe(true, 10_000);
  watchdog.observe(false, 20_000);
  assert.equal(watchdog.isExpired(139_999, 120_000), false);
  assert.equal(watchdog.isExpired(140_000, 120_000), true);
});

test("ReadyWatchdog: 発動後は起点がリセットされる", () => {
  const watchdog = new ReadyWatchdog(0);
  assert.equal(watchdog.isExpired(120_000, 120_000), true);
  watchdog.onFire(120_000);
  assert.equal(watchdog.isExpired(120_000, 120_000), false);
});

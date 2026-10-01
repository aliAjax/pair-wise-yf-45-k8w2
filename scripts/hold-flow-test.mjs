// 逻辑测试：用 esbuild 把 pinia store 打包，shim 掉 vue/pinia/浏览器 API
import { build } from "esbuild";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const shim = `
export function ref(value) { return { __isRef: true, value }; }
export function computed(getter) { return { __isRef: true, get value() { return getter(); } }; }
export const watch = () => {};
export const defineStore = (_name, setup) => () => {
  const target = setup();
  return new Proxy(target, {
    get(t, key) {
      const v = t[key];
      return v && typeof v === "object" && v.__isRef ? v.value : v;
    },
    set(t, key, val) {
      if (t[key] && typeof t[key] === "object" && t[key].__isRef) t[key].value = val;
      else t[key] = val;
      return true;
    }
  });
};
`;
const dir = mkdtempSync(join(tmpdir(), "hold-test-"));
writeFileSync(join(dir, "shim-vue.js"), shim);

// 浏览器环境垫片
const storeData = {};
globalThis.localStorage = {
  getItem: (k) => (k in storeData ? storeData[k] : null),
  setItem: (k, v) => { storeData[k] = String(v); },
  removeItem: (k) => { delete storeData[k]; }
};
globalThis.navigator = { onLine: true };
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, "crypto", { value: { randomUUID: () => "id-" + Math.random().toString(36).slice(2, 10) }, configurable: true });
}
globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));
let nowMs = new Date("2026-10-01T09:00:00Z").getTime();
globalThis.window = { setInterval: () => {} };
globalThis.setInterval = () => {};

await build({
  entryPoints: ["src/stores/schedule.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: join(dir, "store.mjs"),
  alias: { vue: join(dir, "shim-vue.js"), pinia: join(dir, "shim-vue.js") },
  logLevel: "silent"
});

const { useScheduleStore: _unused } = await import(pathToFileURL(join(dir, "store.mjs")).href);
void _unused;
async function freshStore() {
  localStorage.removeItem("pair-wise-yf-45/schedule-v2");
  const mod = await import(pathToFileURL(join(dir, "store.mjs")).href + `?v=${Math.random()}`);
  return mod.useScheduleStore();
}

let pass = 0;
let fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass += 1; console.log("  ✓", name); }
  else { fail += 1; console.log("  ✗", name, extra); }
}
const sceneInput = {
  code: "C-100", title: "码头夜戏", day: "2026-10-15", start: "08:00", end: "11:00",
  locationId: "l1", talentIds: ["t1", "t2"], equipmentIds: ["e1"]
};

console.log("1) 原子抢占：两个统筹同时提交同一批资源");
{
  const s = await freshStore();
  s.operator = "统筹甲"; s.role = "演员统筹";
  const r1 = s.submitReservation(sceneInput);
  check("甲抢到", r1.ok === true);
  check("生成一张预留单和一个草稿场次", s.holds.length === 3 && s.scenes.length === 4);

  s.operator = "统筹乙";
  const input2 = { ...sceneInput, code: "C-101", title: "撞车戏", talentIds: ["t1"], equipmentIds: ["e1"] };
  const r2 = s.submitReservation(input2);
  check("乙被挡回", r2.ok === false);
  if (!r2.ok) {
    check("逐项写出被谁占着（演员+场地+器材 3 项）", r2.blocked.length === 3, JSON.stringify(r2.blocked));
    const names = r2.blocked.map((b) => b.resourceName);
    check("占用方是统筹甲 / 场次 C-100 / 预留中", r2.blocked.every((b) => b.holderOperator === "统筹甲" && b.holderSceneCode === "C-100" && b.holderStatus === "预留中"));
    check("包含演员林川", names.includes("林川"));
    check("包含场地老码头", names.includes("老码头"));
    check("包含器材ARRI A机", names.includes("ARRI A机"));
  }
  check("挡回不产生任何新占用（整笔退回）", s.holds.length === 3 && s.scenes.length === 4);
}

console.log("2) 越权：非制片确认被挡回");
{
  const s = await freshStore();
  s.operator = "统筹乙"; s.role = "演员统筹";
  const pendingId = s.holds.find((h) => h.status === "预留中").id;
  const r = s.confirmReservation(pendingId);
  check("非制片确认被越权拦截", r.ok === false && r.reason.includes("越权"));
  check("预留仍是预留中", s.holds.find((h) => h.id === pendingId).status === "预留中");

  s.role = "制片"; s.operator = "王制片";
  const r2 = s.confirmReservation(pendingId);
  check("制片确认成功", r2.ok === true);
  check("转为正式占用", s.holds.find((h) => h.id === pendingId).status === "已确认");
  const scene = s.scenes.find((sc) => sc.reservationId === pendingId);
  check("对应场次变为已确认", scene && scene.status === "已确认");
}

console.log("3) 满 4 小时没确认自动释放，别人可以接上");
{
  const s = await freshStore();
  const before = s.holds.filter((h) => h.status === "预留中").length;
  s.advanceClock(4);
  const expired = s.holds.filter((h) => h.status === "已释放");
  check("超时预留已释放", expired.length >= before);
  const releasedScene = s.scenes.find((sc) => sc.code === "B-021");
  check("释放后场次解绑 reservationId", !releasedScene.reservationId);

  s.operator = "统筹丙";
  const r = s.submitReservation({ code: "C-200", title: "接手戏", day: "2026-10-09", start: "15:30", end: "17:00", locationId: "l3", talentIds: ["t2"], equipmentIds: ["e1"] });
  check("释放后别人能接上", r.ok === true);
}

console.log("4) 预留期间演员档期被改动 → 立即作废，需重新确认");
{
  const s = await freshStore();
  s.role = "演员统筹"; s.operator = "统筹甲";
  const hold = s.holds.find((h) => h.status === "预留中" && h.day === "2026-10-09" && h.resources.some((r) => r.resourceId === "t2"));
  check("种子里存在 t2 的待确认预留", !!hold);
  const change = s.changeTalentSchedule("t2", "2026-10-09", "突发商演");
  check("档期改动成功", change.ok === true);
  check("关联预留被作废", change.voidedIds.includes(hold.id));
  check("预留状态=已作废并记录原因", s.holds.find((h) => h.id === hold.id).status === "已作废");
  // 正式占用不受影响
  const confirmed = s.holds.find((h) => h.status === "已确认");
  check("正式占用不被档期改动影响", !!confirmed);
  // 重新确认：t2 档期变了，但重新提交时资源池已空可占（模拟改完新档期后重新约）
  const re = s.reReserve(hold.sceneId);
  check("作废后可重新预留", re.ok === true);
  check("重新预留仍是预留中，要等制片再确认", s.holds.find((h) => h.id === re.holdId)?.status === "预留中");

  // 场记改档期越权
  s.role = "场记";
  const denied = s.changeTalentSchedule("t1", "2026-10-08", "乱改");
  check("场记改档期被越权拦截", denied.ok === false);
}

console.log("5) 自己的预留自己可退；不能退别人的");
{
  const s = await freshStore();
  const mine = s.submitReservation({ ...sceneInput, code: "C-300", day: "2026-10-20", talentIds: ["t4"], equipmentIds: ["e4"] });
  check("新预留成功", mine.ok === true);
  s.operator = "统筹乙"; s.role = "演员统筹";
  const denied = s.releaseReservation(mine.holdId);
  check("不能退别人的预留", denied.ok === false);
  s.operator = "统筹甲";
  const ok = s.releaseReservation(mine.holdId);
  check("本人可退回", ok.ok === true);
  check("退回后状态=已释放", s.holds.find((h) => h.id === mine.holdId).status === "已释放");
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);

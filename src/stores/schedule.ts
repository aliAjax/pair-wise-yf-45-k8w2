import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import dayjs from "dayjs";
import type {
  BlockedResource,
  Conflict,
  Equipment,
  HistoryEntry,
  Hold,
  HoldActionResult,
  HoldResource,
  Location,
  OfflineDraft,
  ReservationInput,
  Role,
  ScheduleChangeResult,
  Scene,
  SceneStatus,
  SubmitResult,
  Talent,
  TalentScheduleChange,
  Version
} from "../types";

const STORAGE_KEY = "pair-wise-yf-45/schedule-v2";
const DRAFT_KEY = "pair-wise-yf-45/offline-draft";
/** 预留不确认的超时时间：4 小时 */
const HOLD_TTL_MS = 4 * 60 * 60 * 1000;

const talents: Talent[] = [
  { id: "t1", name: "林川", role: "男主" },
  { id: "t2", name: "周禾", role: "女主" },
  { id: "t3", name: "顾言", role: "配角" },
  { id: "t4", name: "孙宁", role: "群演领队" }
];

const locations: Location[] = [
  { id: "l1", name: "老码头" },
  { id: "l2", name: "玻璃厂房" },
  { id: "l3", name: "南站候车厅" }
];

const equipment: Equipment[] = [
  { id: "e1", name: "ARRI A机" },
  { id: "e2", name: "移动伸缩炮" },
  { id: "e3", name: "LED灯组" },
  { id: "e4", name: "跟拍车" }
];

const seedScenes: Scene[] = [
  { id: "s1", code: "A-012", title: "码头交接", day: "2026-10-08", start: "08:00", end: "11:30", talentIds: ["t1", "t3"], locationId: "l1", equipmentIds: ["e1", "e3"], status: "已确认", locked: false, reservationId: "h1" },
  { id: "s2", code: "A-013", title: "厂房追逐", day: "2026-10-08", start: "10:30", end: "13:00", talentIds: ["t1", "t2"], locationId: "l1", equipmentIds: ["e2", "e4"], status: "草稿", locked: false },
  { id: "s3", code: "B-021", title: "候车厅告别", day: "2026-10-09", start: "15:00", end: "18:30", talentIds: ["t2", "t3"], locationId: "l3", equipmentIds: ["e1"], status: "草稿", locked: false, reservationId: "h2" }
];

/**
 * 种子预留：
 * - h1 已被制片确认，是 s1 的正式占用；
 * - h2 仍是「预留中」，另一个统筹可以立刻试着抢同一批资源看到退回提示。
 */
const seedHolds: Hold[] = [
  {
    id: "h1", sceneId: "s1", code: "A-012", title: "码头交接", day: "2026-10-08", start: "08:00", end: "11:30",
    resources: [
      { type: "演员", resourceId: "t1" }, { type: "演员", resourceId: "t3" },
      { type: "场地", resourceId: "l1" },
      { type: "器材", resourceId: "e1" }, { type: "器材", resourceId: "e3" }
    ],
    operator: "统筹甲", status: "已确认", createdAt: new Date(Date.now() - 6 * 3600_000).toISOString(),
    expiresAt: new Date(Date.now() - 2 * 3600_000).toISOString(), confirmedAt: new Date(Date.now() - 3 * 3600_000).toISOString()
  },
  {
    id: "h2", sceneId: "s3", code: "B-021", title: "候车厅告别", day: "2026-10-09", start: "15:00", end: "18:30",
    resources: [
      { type: "演员", resourceId: "t2" }, { type: "演员", resourceId: "t3" },
      { type: "场地", resourceId: "l3" },
      { type: "器材", resourceId: "e1" }
    ],
    operator: "统筹乙", status: "预留中", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + HOLD_TTL_MS).toISOString()
  }
];

interface PersistShape {
  scenes: Scene[];
  history: HistoryEntry[];
  versions: Version[];
  holds: Hold[];
  scheduleChanges: TalentScheduleChange[];
}

function readState(): Partial<PersistShape> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as PersistShape : {};
  } catch {
    return {};
  }
}

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

interface TimeWindow {
  day: string;
  start: string;
  end: string;
}

function overlaps(a: TimeWindow, b: TimeWindow) {
  return a.day === b.day && minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end);
}

function shared(a: string[], b: string[]) {
  return a.some((value) => b.includes(value));
}

function resourcesOf(input: ReservationInput): HoldResource[] {
  return [
    ...input.talentIds.map((resourceId) => ({ type: "演员" as const, resourceId })),
    { type: "场地" as const, resourceId: input.locationId },
    ...input.equipmentIds.map((resourceId) => ({ type: "器材" as const, resourceId }))
  ];
}

export const useScheduleStore = defineStore("schedule", () => {
  const persisted = readState();
  const scenes = ref<Scene[]>(persisted.scenes ?? structuredClone(seedScenes));
  const holds = ref<Hold[]>(persisted.holds ?? structuredClone(seedHolds));
  const scheduleChanges = ref<TalentScheduleChange[]>(persisted.scheduleChanges ?? []);
  const history = ref<HistoryEntry[]>(persisted.history ?? []);
  const versions = ref<Version[]>(persisted.versions ?? []);
  const role = ref<Role>("制片");
  const operator = ref("统筹甲");
  const exemptions = ref<string[]>([]);
  const online = ref(navigator.onLine);
  const draft = ref<OfflineDraft | null>(null);
  /** 仅用于演示四小时超时：可把系统时钟整体拨快，不落本地存储 */
  const clockOffsetMs = ref(0);
  const now = ref(Date.now());
  window.setInterval(() => { now.value = Date.now() + clockOffsetMs.value; }, 1000);

  const talentNames = (ids: string[]) => ids.map((id) => talents.find((item) => item.id === id)?.name ?? id);
  const locationName = (id: string) => locations.find((item) => item.id === id)?.name ?? id;
  const equipmentNames = (ids: string[]) => ids.map((id) => equipment.find((item) => item.id === id)?.name ?? id);

  function resourceName(type: HoldResource["type"], id: string) {
    if (type === "演员") return talents.find((item) => item.id === id)?.name ?? id;
    if (type === "场地") return locations.find((item) => item.id === id)?.name ?? id;
    return equipment.find((item) => item.id === id)?.name ?? id;
  }

  const activeHolds = computed(() => holds.value.filter((hold) => hold.status === "预留中" || hold.status === "已确认"));
  const pendingHolds = computed(() => holds.value.filter((hold) => hold.status === "预留中"));
  const sortedHolds = computed(() => [...holds.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

  function holdByScene(sceneId: string) {
    return holds.value.find((hold) => hold.sceneId === sceneId && (hold.status === "预留中" || hold.status === "已确认"));
  }

  /**
   * 预留抢占检查：对每项资源找时间窗重叠的有效预留。
   * 返回被挡清单，空数组代表全部抢到手。
   */
  function findBlocked(window: TimeWindow, wanted: HoldResource[], excludeHoldId?: string): BlockedResource[] {
    const blocked: BlockedResource[] = [];
    const seen = new Set<string>();
    for (const wantedResource of wanted) {
      for (const holder of activeHolds.value) {
        if (holder.id === excludeHoldId) continue;
        if (!overlaps(window, holder)) continue;
        const clash = holder.resources.find((res) => res.type === wantedResource.type && res.resourceId === wantedResource.resourceId);
        if (!clash) continue;
        const dedupeKey = `${wantedResource.type}:${wantedResource.resourceId}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        const holderScene = scenes.value.find((scene) => scene.id === holder.sceneId);
        blocked.push({
          ...wantedResource,
          resourceName: resourceName(wantedResource.type, wantedResource.resourceId),
          holderHoldId: holder.id,
          holderSceneId: holder.sceneId,
          holderSceneCode: holderScene?.code ?? holder.code,
          holderOperator: holder.operator,
          holderStatus: holder.status,
          holderExpiresAt: holder.status === "预留中" ? holder.expiresAt : undefined
        });
      }
    }
    return blocked;
  }

  /** 满四小时没确认的预留自动释放，别人可以接上 */
  function sweepExpiredHolds(log = false) {
    const expired = holds.value.filter((hold) => hold.status === "预留中" && now.value >= new Date(hold.expiresAt).getTime());
    for (const hold of expired) {
      hold.status = "已释放";
      hold.releasedAt = new Date(now.value).toISOString();
      const scene = scenes.value.find((item) => item.id === hold.sceneId);
      if (scene?.reservationId === hold.id) scene.reservationId = undefined;
      if (log) addLog("预留超时释放", `${hold.code} 满4小时未确认，演员/场地/器材已退回可抢池`);
    }
    return expired.length;
  }
  setInterval(() => sweepExpiredHolds(true), 15_000);

  /**
   * 提交场次即开预留单：演员、场地、器材一起占。
   * 任意一项被别人先占，整笔退回（不产生任何占用），并列出被谁占着。
   */
  function submitReservation(input: ReservationInput, who = operator.value): SubmitResult {
    sweepExpiredHolds();
    const wanted = resourcesOf(input);
    const blocked = findBlocked(input, wanted);
    if (blocked.length) {
      addLog("预留被挡回", `${input.code} 由 ${who} 提交，${blocked.length} 项资源已被占用，整笔退回`);
      return { ok: false, blocked };
    }
    const sceneId = crypto.randomUUID();
    const holdId = crypto.randomUUID();
    const createdAtIso = new Date(now.value).toISOString();
    const scene: Scene = { ...input, id: sceneId, status: "草稿", locked: false, reservationId: holdId };
    const hold: Hold = {
      id: holdId, sceneId, code: input.code, title: input.title, day: input.day, start: input.start, end: input.end,
      resources: wanted, operator: who, status: "预留中",
      createdAt: createdAtIso, expiresAt: new Date(now.value + HOLD_TTL_MS).toISOString()
    };
    scenes.value.push(scene);
    holds.value.unshift(hold);
    addLog("提交预留", `${input.code} 由 ${who} 占住演员/场地/器材，4小时内待制片确认`);
    return { ok: true, holdId, sceneId };
  }

  /** 制片确认后，预留转成正式占用 */
  function confirmReservation(holdId: string, who = operator.value): HoldActionResult {
    if (role.value !== "制片") {
      addLog("越权拦截", `${who}（${role.value}）试图确认预留 ${holdId}，只有制片可确认，已挡回`);
      return { ok: false, holdId, reason: "越权：只有制片能确认预留，操作已挡回" };
    }
    sweepExpiredHolds();
    const hold = holds.value.find((item) => item.id === holdId);
    if (!hold) return { ok: false, holdId, reason: "预留单不存在" };
    if (hold.status === "已确认") return { ok: false, holdId, reason: "该预留已是正式占用" };
    if (hold.status !== "预留中") return { ok: false, holdId, reason: `预留状态为「${hold.status}」，无法确认` };
    hold.status = "已确认";
    hold.confirmedAt = new Date(now.value).toISOString();
    const scene = scenes.value.find((item) => item.id === hold.sceneId);
    if (scene) scene.status = "已确认";
    addLog("确认预留", `${hold.code} 由制片 ${who} 确认，转为正式占用`);
    return { ok: true, holdId };
  }

  /** 主动退回预留（提交人本人或制片） */
  function releaseReservation(holdId: string, who = operator.value): HoldActionResult {
    const hold = holds.value.find((item) => item.id === holdId);
    if (!hold) return { ok: false, holdId, reason: "预留单不存在" };
    if (hold.status !== "预留中") return { ok: false, holdId, reason: `预留状态为「${hold.status}」，无需释放` };
    if (role.value !== "制片" && hold.operator !== who) {
      addLog("越权拦截", `${who}（${role.value}）试图释放 ${hold.operator} 的预留 ${hold.code}，已挡回`);
      return { ok: false, holdId, reason: "越权：只能释放自己提交的预留" };
    }
    hold.status = "已释放";
    hold.releasedAt = new Date(now.value).toISOString();
    const scene = scenes.value.find((item) => item.id === hold.sceneId);
    if (scene?.reservationId === holdId) scene.reservationId = undefined;
    addLog("释放预留", `${hold.code} 由 ${who} 主动退回，资源已开放`);
    return { ok: true, holdId };
  }

  /** 已释放/已作废的场次重新走一遍抢占 */
  function reReserve(sceneId: string, who = operator.value): HoldActionResult {
    sweepExpiredHolds();
    const scene = scenes.value.find((item) => item.id === sceneId);
    if (!scene) return { ok: false, reason: "场次不存在" };
    const latest = holds.value.find((item) => item.sceneId === sceneId);
    if (latest && (latest.status === "预留中" || latest.status === "已确认")) {
      return { ok: false, holdId: latest.id, reason: `该场次已有${latest.status === "预留中" ? "预留" : "正式占用"}，无需重新确认` };
    }
    const input: ReservationInput = {
      code: scene.code, title: scene.title, day: scene.day, start: scene.start, end: scene.end,
      talentIds: [...scene.talentIds], locationId: scene.locationId, equipmentIds: [...scene.equipmentIds]
    };
    const wanted = resourcesOf(input);
    const blocked = findBlocked(input, wanted);
    if (blocked.length) {
      addLog("重新预留失败", `${scene.code} 由 ${who} 重新提交，${blocked.length} 项资源仍被占用`);
      return { ok: false, blocked, reason: "资源已被别人接上" };
    }
    const holdId = crypto.randomUUID();
    holds.value.unshift({
      id: holdId, sceneId, code: scene.code, title: scene.title, day: scene.day, start: scene.start, end: scene.end,
      resources: wanted, operator: who, status: "预留中",
      createdAt: new Date(now.value).toISOString(), expiresAt: new Date(now.value + HOLD_TTL_MS).toISOString()
    });
    scene.reservationId = holdId;
    scene.status = "草稿";
    addLog("重新预留", `${scene.code} 由 ${who} 重新占住资源`);
    return { ok: true, holdId };
  }

  /**
   * 演员档期被改动：该演员当天所有「预留中」立即作废，必须重新确认。
   * 已经制片确认的正式占用不动。
   */
  function changeTalentSchedule(talentId: string, day: string, reason: string, who = operator.value): ScheduleChangeResult {
    if (role.value !== "演员统筹" && role.value !== "制片") {
      addLog("越权拦截", `${who}（${role.value}）试图改动演员档期，已挡回`);
      return { ok: false, reason: "越权：只有演员统筹/制片能改动演员档期", voidedIds: [] };
    }
    const change: TalentScheduleChange = {
      id: crypto.randomUUID(), talentId, day, reason: reason || "未填写原因", operator: who, time: new Date(now.value).toISOString()
    };
    scheduleChanges.value.unshift(change);
    const voidedIds: string[] = [];
    for (const hold of holds.value) {
      if (hold.status !== "预留中" || hold.day !== day) continue;
      if (!hold.resources.some((res) => res.type === "演员" && res.resourceId === talentId)) continue;
      hold.status = "已作废";
      hold.voidReason = `演员 ${resourceName("演员", talentId)} 于 ${day} 档期被改动（${change.reason}）`;
      const scene = scenes.value.find((item) => item.id === hold.sceneId);
      if (scene?.reservationId === hold.id) scene.reservationId = undefined;
      voidedIds.push(hold.id);
    }
    addLog("演员档期改动", `${resourceName("演员", talentId)} ${day} 档期由 ${who} 改动，作废 ${voidedIds.length} 张预留`);
    return { ok: true, voidedIds };
  }

  function remainingMs(hold: Hold) {
    if (hold.status !== "预留中") return 0;
    return Math.max(0, new Date(hold.expiresAt).getTime() - now.value);
  }

  function formatRemaining(hold: Hold) {
    if (hold.status !== "预留中") return "—";
    const ms = remainingMs(hold);
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function advanceClock(hours: number) {
    clockOffsetMs.value += hours * 3600_000;
    now.value = Date.now() + clockOffsetMs.value;
    sweepExpiredHolds(true);
  }

  function resetClock() {
    clockOffsetMs.value = 0;
    now.value = Date.now();
  }

  const conflicts = computed<Conflict[]>(() => {
    const result: Conflict[] = [];
    for (let i = 0; i < scenes.value.length; i += 1) {
      for (let j = i + 1; j < scenes.value.length; j += 1) {
        const a = scenes.value[i];
        const b = scenes.value[j];
        if (!overlaps(a, b)) continue;
        // 已被同一张预留单原子占住的组合不算冲突
        if (a.reservationId && a.reservationId === b.reservationId) continue;
        const id = `${a.id}:${b.id}`;
        if (exemptions.value.includes(id)) continue;
        if (shared(a.talentIds, b.talentIds)) result.push({ id: `${id}:talent`, type: "演员档期", sceneIds: [a.id, b.id], message: `${talentNames(a.talentIds.filter((item) => b.talentIds.includes(item))).join("、")} 在两场戏中档期重叠`, severity: "高" });
        if (a.locationId === b.locationId) result.push({ id: `${id}:location`, type: "场地占用", sceneIds: [a.id, b.id], message: `${locationName(a.locationId)} 被同时占用`, severity: "高" });
        if (shared(a.equipmentIds, b.equipmentIds)) result.push({ id: `${id}:equipment`, type: "器材借用", sceneIds: [a.id, b.id], message: `${equipmentNames(a.equipmentIds.filter((item) => b.equipmentIds.includes(item))).join("、")} 发生借用重叠`, severity: "中" });
        if (a.locationId !== b.locationId && minutes(b.start) - minutes(a.end) < 30) result.push({ id: `${id}:transfer`, type: "转场时间", sceneIds: [a.id, b.id], message: "两个场地之间转场时间不足30分钟", severity: "中" });
      }
    }
    return result;
  });

  const sortedScenes = computed(() => [...scenes.value].sort((a, b) => `${a.day} ${a.start}`.localeCompare(`${b.day} ${b.start}`)));

  function addLog(action: string, detail: string) {
    history.value.unshift({ id: crypto.randomUUID(), action, detail, time: new Date(now.value).toISOString() });
    history.value = history.value.slice(0, 100);
  }

  function persist() {
    const data: PersistShape = { scenes: scenes.value, history: history.value, versions: versions.value, holds: holds.value, scheduleChanges: scheduleChanges.value };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  watch([scenes, history, versions, holds, scheduleChanges], persist, { deep: true });

  function updateStatus(id: string, status: SceneStatus) {
    const scene = scenes.value.find((item) => item.id === id);
    if (!scene || scene.locked) return;
    // 挂着「预留中」的场次必须等制片确认预留，不许直接推进状态
    const hold = holdByScene(id);
    if (hold?.status === "预留中" && status !== scene.status) {
      addLog("越权拦截", `场次 ${scene.code} 资源仍在预留中，需制片在预留流程确认，直接推进状态已挡回`);
      return { ok: false, reason: "该场次资源仍在预留中，需制片确认预留后才能推进" };
    }
    scene.status = status;
    addLog("流转状态", `${scene.code} → ${status}`);
    return { ok: true };
  }

  function toggleLock(id: string) {
    const scene = scenes.value.find((item) => item.id === id);
    if (!scene) return;
    scene.locked = !scene.locked;
    addLog(scene.locked ? "锁定场次" : "解锁场次", scene.code);
  }

  function moveScene(from: number, to: number) {
    if (from === to || to < 0 || to >= scenes.value.length) return;
    const [item] = scenes.value.splice(from, 1);
    scenes.value.splice(to, 0, item);
    addLog("调整顺序", `${item.code} 移至第 ${to + 1} 位`);
  }

  function snapshot(name = `版本 ${versions.value.length + 1}`) {
    versions.value.unshift({ id: crypto.randomUUID(), name, time: new Date(now.value).toISOString(), scenes: structuredClone(scenes.value) });
    versions.value = versions.value.slice(0, 12);
    addLog("保存版本", name);
  }

  function restore(id: string) {
    const version = versions.value.find((item) => item.id === id);
    if (!version) return;
    scenes.value = structuredClone(version.scenes);
    addLog("恢复版本", version.name);
  }

  function saveDraft() {
    draft.value = { scenes: structuredClone(scenes.value), savedAt: new Date(now.value).toISOString() };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft.value));
    addLog("保存离线草稿", dayjs(draft.value.savedAt).format("MM-DD HH:mm"));
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      draft.value = raw ? JSON.parse(raw) as OfflineDraft : null;
    } catch {
      draft.value = null;
    }
  }

  function syncDraft() {
    if (!draft.value) return;
    scenes.value = structuredClone(draft.value.scenes);
    addLog("同步离线草稿", `同步 ${draft.value.scenes.length} 个场次`);
    draft.value = null;
    localStorage.removeItem(DRAFT_KEY);
  }

  function exempt(id: string) {
    exemptions.value.push(id);
    addLog("豁免冲突", id);
  }

  function setOnline(value: boolean) {
    online.value = value;
  }

  // 打开页面先清一遍已经过期的预留
  sweepExpiredHolds();

  return {
    scenes, sortedScenes, conflicts, history, versions, holds, sortedHolds, pendingHolds, activeHolds, scheduleChanges,
    role, operator, exemptions, online, draft, now, clockOffsetMs,
    talents, locations, equipment,
    talentNames, equipmentNames, locationName, resourceName, holdByScene,
    findBlocked, remainingMs, formatRemaining, advanceClock, resetClock,
    submitReservation, confirmReservation, releaseReservation, reReserve, changeTalentSchedule,
    updateStatus, toggleLock, moveScene, snapshot, restore, saveDraft, loadDraft, syncDraft, exempt, setOnline
  };
});

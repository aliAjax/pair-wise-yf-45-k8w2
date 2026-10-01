import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import dayjs from "dayjs";
import type { ActionResult, Conflict, Equipment, HistoryEntry, HoldFailure, HoldResult, Location, OfflineDraft, Reservation, Role, Scene, SceneStatus, Talent, TalentSchedule, Version } from "../types";

const STORAGE_KEY = "pair-wise-yf-45/schedule-v1";
const DRAFT_KEY = "pair-wise-yf-45/offline-draft";
export const HOLD_TTL_HOURS = 4;

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
  { id: "s1", code: "A-012", title: "码头交接", day: "2026-10-08", start: "08:00", end: "11:30", talentIds: ["t1", "t3"], locationId: "l1", equipmentIds: ["e1", "e3"], status: "已确认", locked: false },
  { id: "s2", code: "A-013", title: "厂房追逐", day: "2026-10-08", start: "10:30", end: "13:00", talentIds: ["t1", "t2"], locationId: "l1", equipmentIds: ["e2", "e4"], status: "草稿", locked: false },
  { id: "s3", code: "B-021", title: "候车厅告别", day: "2026-10-09", start: "15:00", end: "18:30", talentIds: ["t2", "t3"], locationId: "l3", equipmentIds: ["e1"], status: "草稿", locked: false },
  { id: "s4", code: "A-014", title: "夜戏补拍", day: "2026-10-08", start: "19:00", end: "21:00", talentIds: ["t2"], locationId: "l2", equipmentIds: ["e2"], status: "草稿", locked: false }
];

function seedTalentSchedules(): TalentSchedule[] {
  const now = dayjs().toISOString();
  return [
    { talentId: "t1", note: "10月8日—10月10日 可拍", updatedAt: now, revision: 1 },
    { talentId: "t2", note: "10月8日 全天", updatedAt: now, revision: 1 },
    { talentId: "t3", note: "10月8日—10月9日", updatedAt: now, revision: 1 },
    { talentId: "t4", note: "随组待命", updatedAt: now, revision: 1 }
  ];
}

function seedReservations(): Reservation[] {
  const now = dayjs();
  const s1 = seedScenes[0];
  const s4 = seedScenes[3];
  return [
    {
      id: "r-seed-s1", sceneId: s1.id, sceneCode: s1.code, sceneTitle: s1.title,
      day: s1.day, start: s1.start, end: s1.end,
      talentIds: [...s1.talentIds], locationId: s1.locationId, equipmentIds: [...s1.equipmentIds],
      status: "已确认", heldAt: now.subtract(2, "day").toISOString(), expiresAt: now.subtract(2, "day").add(HOLD_TTL_HOURS, "hour").toISOString(),
      confirmedAt: now.subtract(2, "day").toISOString(), createdBy: "制片", confirmedBy: "制片", voidReason: null,
      scheduleRevisions: { t1: 1, t3: 1 }
    },
    {
      id: "r-seed-s4", sceneId: s4.id, sceneCode: s4.code, sceneTitle: s4.title,
      day: s4.day, start: s4.start, end: s4.end,
      talentIds: [...s4.talentIds], locationId: s4.locationId, equipmentIds: [...s4.equipmentIds],
      status: "预留中", heldAt: now.subtract(30, "minute").toISOString(), expiresAt: now.add(3.5, "hour").toISOString(),
      confirmedAt: null, createdBy: "演员统筹", confirmedBy: null, voidReason: null,
      scheduleRevisions: { t2: 1 }
    }
  ];
}

function readScenes(): Scene[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).scenes as Scene[] : structuredClone(seedScenes);
  } catch {
    return structuredClone(seedScenes);
  }
}

function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).history as HistoryEntry[] : [];
  } catch {
    return [];
  }
}

function readVersions(): Version[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).versions as Version[] : [];
  } catch {
    return [];
  }
}

function readReservations(): Reservation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.reservations)) return parsed.reservations as Reservation[];
    }
  } catch { /* ignore */ }
  return seedReservations();
}

function readTalentSchedules(): TalentSchedule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.talentSchedules)) return parsed.talentSchedules as TalentSchedule[];
    }
  } catch { /* ignore */ }
  return seedTalentSchedules();
}

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function overlaps(a: Scene, b: Scene) {
  return a.day === b.day && minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end);
}

function shared(a: string[], b: string[]) {
  return a.some((value) => b.includes(value));
}

interface SlotInput {
  code: string;
  title: string;
  day: string;
  start: string;
  end: string;
  talentIds: string[];
  locationId: string;
  equipmentIds: string[];
}

export const useScheduleStore = defineStore("schedule", () => {
  const scenes = ref<Scene[]>(readScenes());
  const history = ref<HistoryEntry[]>(readHistory());
  const versions = ref<Version[]>(readVersions());
  const reservations = ref<Reservation[]>(readReservations());
  const talentSchedules = ref<TalentSchedule[]>(readTalentSchedules());
  const role = ref<Role>("制片");
  const exemptions = ref<string[]>([]);
  const online = ref(navigator.onLine);
  const draft = ref<OfflineDraft | null>(null);
  const nowTick = ref(Date.now());

  const talentNames = (ids: string[]) => ids.map((id) => talents.find((item) => item.id === id)?.name ?? id);
  const locationName = (id: string) => locations.find((item) => item.id === id)?.name ?? id;
  const equipmentNames = (ids: string[]) => ids.map((id) => equipment.find((item) => item.id === id)?.name ?? id);
  const talentName = (id: string) => talents.find((item) => item.id === id)?.name ?? id;

  const conflicts = computed<Conflict[]>(() => {
    const result: Conflict[] = [];
    for (let i = 0; i < scenes.value.length; i += 1) {
      for (let j = i + 1; j < scenes.value.length; j += 1) {
        const a = scenes.value[i];
        const b = scenes.value[j];
        if (!overlaps(a, b)) continue;
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

  const activeHolds = computed(() => reservations.value.filter((item) => isHolding(item)));

  function log(action: string, detail: string) {
    history.value.unshift({ id: crypto.randomUUID(), action, detail, time: new Date().toISOString() });
    history.value = history.value.slice(0, 80);
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      scenes: scenes.value,
      history: history.value,
      versions: versions.value,
      reservations: reservations.value,
      talentSchedules: talentSchedules.value
    }));
  }

  watch([scenes, history, versions, reservations, talentSchedules], persist, { deep: true });

  // ---- 预留状态判定 ----
  function isActiveHold(r: Reservation) {
    return r.status === "预留中" && dayjs(r.expiresAt).isAfter(dayjs(nowTick.value));
  }
  function isFormalHold(r: Reservation) {
    return r.status === "已确认";
  }
  function isHolding(r: Reservation) {
    return isActiveHold(r) || isFormalHold(r);
  }

  function releaseExpired() {
    const now = dayjs(nowTick.value);
    let changed = false;
    for (const r of reservations.value) {
      if (r.status === "预留中" && dayjs(r.expiresAt).valueOf() <= now.valueOf()) {
        r.status = "已释放";
        log("预留到期释放", `${r.sceneCode} ${r.sceneTitle} 满${HOLD_TTL_HOURS}小时未确认，资源已释放`);
        changed = true;
      }
    }
    return changed;
  }

  setInterval(() => {
    nowTick.value = Date.now();
    releaseExpired();
  }, 60_000);

  // ---- 原子预留：提交时一起占住演员/场地/器材 ----
  function slotOverlaps(r: Reservation, input: SlotInput) {
    return r.day === input.day && minutes(r.start) < minutes(input.end) && minutes(input.start) < minutes(r.end);
  }

  function findHoldFailures(input: SlotInput, excludeReservationId?: string): HoldFailure[] {
    const failures: HoldFailure[] = [];
    for (const r of reservations.value) {
      if (r.id === excludeReservationId) continue;
      if (!isHolding(r) || !slotOverlaps(r, input)) continue;
      const holderScene = `${r.sceneCode} ${r.sceneTitle}`;
      if (shared(r.talentIds, input.talentIds)) {
        for (const id of r.talentIds.filter((x) => input.talentIds.includes(x))) {
          failures.push({ resourceType: "演员", resourceName: talentName(id), holderScene, holderBy: r.createdBy, holderStatus: r.status, holdEndsAt: r.status === "预留中" ? r.expiresAt : null });
        }
      }
      if (r.locationId === input.locationId) {
        failures.push({ resourceType: "场地", resourceName: locationName(r.locationId), holderScene, holderBy: r.createdBy, holderStatus: r.status, holdEndsAt: r.status === "预留中" ? r.expiresAt : null });
      }
      if (shared(r.equipmentIds, input.equipmentIds)) {
        for (const id of r.equipmentIds.filter((x) => input.equipmentIds.includes(x))) {
          failures.push({ resourceType: "器材", resourceName: equipment.find((item) => item.id === id)?.name ?? id, holderScene, holderBy: r.createdBy, holderStatus: r.status, holdEndsAt: r.status === "预留中" ? r.expiresAt : null });
        }
      }
    }
    return failures;
  }

  function attemptHold(input: SlotInput): HoldResult {
    releaseExpired();
    const failures = findHoldFailures(input);
    if (failures.length) {
      const head = failures[0];
      log("预留被退回", `${input.code} ${input.title} 与 ${head.holderScene} 冲突：${head.resourceType} ${head.resourceName} 已被占着`);
      return { ok: false, failures };
    }
    const scene: Scene = {
      id: crypto.randomUUID(),
      code: input.code,
      title: input.title,
      day: input.day,
      start: input.start,
      end: input.end,
      talentIds: [...input.talentIds],
      locationId: input.locationId,
      equipmentIds: [...input.equipmentIds],
      status: "草稿",
      locked: false
    };
    scenes.value.push(scene);
    const now = dayjs();
    const reservation: Reservation = {
      id: crypto.randomUUID(),
      sceneId: scene.id,
      sceneCode: scene.code,
      sceneTitle: scene.title,
      day: scene.day,
      start: scene.start,
      end: scene.end,
      talentIds: [...scene.talentIds],
      locationId: scene.locationId,
      equipmentIds: [...scene.equipmentIds],
      status: "预留中",
      heldAt: now.toISOString(),
      expiresAt: now.add(HOLD_TTL_HOURS, "hour").toISOString(),
      confirmedAt: null,
      createdBy: role.value,
      confirmedBy: null,
      voidReason: null,
      scheduleRevisions: Object.fromEntries(talentSchedules.value.map((item) => [item.talentId, item.revision]))
    };
    reservations.value.push(reservation);
    log("提交预留", `${scene.code} ${scene.title} 已占住演员/场地/器材，${HOLD_TTL_HOURS}小时内待制片确认`);
    return { ok: true, reservation };
  }

  // ---- 制片确认 → 正式占用（非制片按越权挡回） ----
  function requireProducer(): ActionResult | null {
    if (role.value !== "制片") {
      return { ok: false, message: `越权：当前角色为${role.value}，只有制片能确认预留并转为正式占用` };
    }
    return null;
  }

  function confirmReservation(id: string): ActionResult {
    const denied = requireProducer();
    if (denied) {
      log("越权确认被挡", `${role.value} 尝试确认预留`);
      return denied;
    }
    releaseExpired();
    const r = reservations.value.find((item) => item.id === id);
    if (!r) return { ok: false, message: "预留不存在或已被移除" };
    if (r.status === "已确认") return { ok: false, message: "该预留已转为正式占用，无需重复确认" };
    if (r.status === "已释放") return { ok: false, message: "预留已释放：满4小时未确认，资源已被他人接上" };
    if (r.status === "已作废") return { ok: false, message: "预留已作废：演员档期被改动，请重新确认" };
    const failures = findHoldFailures(slotFromReservation(r), r.id);
    if (failures.length) {
      r.status = "已作废";
      r.voidReason = `确认时资源已被 ${failures[0].holderScene} 占用`;
      log("预留确认失败", `${r.sceneCode} ${r.sceneTitle} 资源已被他人占去`);
      return { ok: false, message: `确认失败：资源已被 ${failures[0].holderScene} 占着` };
    }
    r.status = "已确认";
    r.confirmedAt = dayjs().toISOString();
    r.confirmedBy = role.value;
    const scene = scenes.value.find((item) => item.id === r.sceneId);
    if (scene) scene.status = "已确认";
    log("制片确认预留", `${r.sceneCode} ${r.sceneTitle} 转为正式占用`);
    return { ok: true, message: "已确认，转为正式占用" };
  }

  // ---- 作废后重新确认（仍需制片，且重新原子抢资源） ----
  function reconfirmReservation(id: string): ActionResult {
    const denied = requireProducer();
    if (denied) {
      log("越权重新确认被挡", `${role.value} 尝试重新确认预留`);
      return denied;
    }
    releaseExpired();
    const r = reservations.value.find((item) => item.id === id);
    if (!r) return { ok: false, message: "预留不存在或已被移除" };
    if (r.status !== "已作废") return { ok: false, message: "仅作废的预留需要重新确认" };
    const failures = findHoldFailures(slotFromReservation(r), r.id);
    if (failures.length) return { ok: false, message: `重新确认失败：资源已被 ${failures[0].holderScene} 占着` };
    r.status = "已确认";
    r.confirmedAt = dayjs().toISOString();
    r.confirmedBy = role.value;
    r.voidReason = null;
    const scene = scenes.value.find((item) => item.id === r.sceneId);
    if (scene) scene.status = "已确认";
    log("重新确认预留", `${r.sceneCode} ${r.sceneTitle} 重新确认并转为正式占用`);
    return { ok: true, message: "已重新确认，转为正式占用" };
  }

  // ---- 手动释放（提交方或制片可提前释放，别人即可接上） ----
  function releaseReservation(id: string): ActionResult {
    const r = reservations.value.find((item) => item.id === id);
    if (!r) return { ok: false, message: "预留不存在或已被移除" };
    if (r.status !== "预留中") return { ok: false, message: "仅预留中的记录可释放" };
    if (r.createdBy !== role.value && role.value !== "制片") {
      return { ok: false, message: `越权：只有提交方（${r.createdBy}）或制片能释放该预留` };
    }
    r.status = "已释放";
    log("手动释放预留", `${r.sceneCode} ${r.sceneTitle} 已释放，资源可被他人接上`);
    return { ok: true, message: "预留已释放" };
  }

  // ---- 演员档期改动 → 预留立即作废 ----
  function modifyTalentSchedule(talentId: string, note: string): ActionResult {
    let sched = talentSchedules.value.find((item) => item.talentId === talentId);
    if (!sched) {
      sched = { talentId, note, updatedAt: dayjs().toISOString(), revision: 1 };
      talentSchedules.value.push(sched);
    } else {
      sched.note = note;
      sched.updatedAt = dayjs().toISOString();
      sched.revision += 1;
    }
    const name = talentName(talentId);
    let voided = 0;
    for (const r of reservations.value) {
      if (r.status === "预留中" && r.talentIds.includes(talentId)) {
        r.status = "已作废";
        r.voidReason = `演员 ${name} 档期已改动（${note}）`;
        voided += 1;
        log("预留立即作废", `${r.sceneCode} ${r.sceneTitle} 因演员 ${name} 档期改动而作废`);
      }
    }
    log("调整演员档期", `${name}：${note}${voided ? `，${voided} 项预留作废` : ""}`);
    return { ok: true, message: voided ? `档期已更新，${voided} 项预留立即作废` : "档期已更新" };
  }

  function slotFromReservation(r: Reservation): SlotInput {
    return { code: r.sceneCode, title: r.sceneTitle, day: r.day, start: r.start, end: r.end, talentIds: [...r.talentIds], locationId: r.locationId, equipmentIds: [...r.equipmentIds] };
  }

  function addScene(input: Omit<Scene, "id" | "status" | "locked">) {
    scenes.value.push({ ...input, id: crypto.randomUUID(), status: "草稿", locked: false });
    log("新增场次", `${input.code} ${input.title}`);
  }

  function updateStatus(id: string, status: SceneStatus) {
    const scene = scenes.value.find((item) => item.id === id);
    if (!scene || scene.locked) return;
    scene.status = status;
    log("流转状态", `${scene.code} → ${status}`);
  }

  function toggleLock(id: string) {
    const scene = scenes.value.find((item) => item.id === id);
    if (!scene) return;
    scene.locked = !scene.locked;
    log(scene.locked ? "锁定场次" : "解锁场次", scene.code);
  }

  function moveScene(from: number, to: number) {
    if (from === to || to < 0 || to >= scenes.value.length) return;
    const [item] = scenes.value.splice(from, 1);
    scenes.value.splice(to, 0, item);
    log("调整顺序", `${item.code} 移至第 ${to + 1} 位`);
  }

  function snapshot(name = `版本 ${versions.value.length + 1}`) {
    versions.value.unshift({ id: crypto.randomUUID(), name, time: new Date().toISOString(), scenes: structuredClone(scenes.value) });
    versions.value = versions.value.slice(0, 12);
    log("保存版本", name);
  }

  function restore(id: string) {
    const version = versions.value.find((item) => item.id === id);
    if (!version) return;
    scenes.value = structuredClone(version.scenes);
    reservations.value = reservations.value.filter((r) => scenes.value.some((s) => s.id === r.sceneId));
    log("恢复版本", version.name);
  }

  function saveDraft() {
    draft.value = { scenes: structuredClone(scenes.value), savedAt: new Date().toISOString() };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft.value));
    log("保存离线草稿", dayjs(draft.value.savedAt).format("MM-DD HH:mm"));
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
    reservations.value = reservations.value.filter((r) => scenes.value.some((s) => s.id === r.sceneId));
    log("同步离线草稿", `同步 ${draft.value.scenes.length} 个场次`);
    draft.value = null;
    localStorage.removeItem(DRAFT_KEY);
  }

  function exempt(id: string) {
    exemptions.value.push(id);
    log("豁免冲突", id);
  }

  function setOnline(value: boolean) {
    online.value = value;
  }

  return {
    scenes, sortedScenes, conflicts, history, versions, role, exemptions, online, draft, nowTick,
    talents, locations, equipment, talentSchedules, reservations, activeHolds,
    talentNames, equipmentNames, locationName, talentName,
    attemptHold, confirmReservation, reconfirmReservation, releaseReservation, modifyTalentSchedule,
    isActiveHold, isFormalHold, addScene, updateStatus, toggleLock, moveScene,
    snapshot, restore, saveDraft, loadDraft, syncDraft, exempt, setOnline
  };
});

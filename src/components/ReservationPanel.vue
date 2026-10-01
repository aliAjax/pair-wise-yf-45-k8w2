<script setup lang="ts">
import { computed } from "vue";
import { ElMessage } from "element-plus";
import dayjs from "dayjs";
import { useScheduleStore, HOLD_TTL_HOURS } from "../stores/schedule";
import type { Reservation } from "../types";

const store = useScheduleStore();

const sorted = computed(() =>
  [...store.reservations].sort((a, b) => dayjs(b.heldAt).valueOf() - dayjs(a.heldAt).valueOf())
);

const counts = computed(() => ({
  active: store.reservations.filter((r) => store.isActiveHold(r)).length,
  formal: store.reservations.filter((r) => r.status === "已确认").length,
  voided: store.reservations.filter((r) => r.status === "已作废").length
}));

function remaining(r: Reservation) {
  const ms = dayjs(r.expiresAt).valueOf() - store.nowTick;
  if (ms <= 0) return "已到期";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `剩余 ${h}h ${m}m`;
}

function onConfirm(r: Reservation) {
  const result = store.confirmReservation(r.id);
  if (result.ok) ElMessage.success(result.message);
  else ElMessage.error(result.message);
}

function onReconfirm(r: Reservation) {
  const result = store.reconfirmReservation(r.id);
  if (result.ok) ElMessage.success(result.message);
  else ElMessage.error(result.message);
}

function onRelease(r: Reservation) {
  const result = store.releaseReservation(r.id);
  if (result.ok) ElMessage.success(result.message);
  else ElMessage.error(result.message);
}
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>预留与正式占用</h2>
        <small class="muted">提交即原子占住演员/场地/器材；预留满 {{ HOLD_TTL_HOURS }} 小时未确认自动释放，制片确认后转正式占用</small>
      </div>
      <span class="status">{{ counts.active }} 项预留中 · {{ counts.formal }} 项正式占用<template v-if="counts.voided"> · {{ counts.voided }} 项作废</template></span>
    </div>
    <el-empty v-if="!sorted.length" description="暂无预留记录，提交场次即可占住资源" />
    <article v-for="r in sorted" :key="r.id" class="hold" :class="r.status">
      <div class="hold-top">
        <b class="hold-code">{{ r.sceneCode }}</b>
        <b class="hold-title">{{ r.sceneTitle }}</b>
        <span class="status" :class="r.status">{{ r.status }}</span>
        <span v-if="r.status === '预留中'" class="hold-countdown">{{ remaining(r) }}</span>
        <span v-else-if="r.status === '已确认'" class="hold-formal">正式占用</span>
      </div>
      <div class="hold-slot">
        <span>{{ r.day }} {{ r.start }}–{{ r.end }}</span>
        <span>场地：{{ store.locationName(r.locationId) }}</span>
        <span>演员：{{ store.talentNames(r.talentIds).join("、") || "待定" }}</span>
        <span>器材：{{ store.equipmentNames(r.equipmentIds).join("、") || "无" }}</span>
      </div>
      <div class="hold-meta">
        <small>提交：{{ r.createdBy }} · {{ dayjs(r.heldAt).format("MM-DD HH:mm") }}</small>
        <small v-if="r.confirmedBy">确认：{{ r.confirmedBy }} · {{ dayjs(r.confirmedAt).format("MM-DD HH:mm") }}</small>
        <small v-if="r.status === '预留中' && r.createdBy !== store.role && store.role !== '制片'" class="muted">仅提交方或制片可释放</small>
        <small v-if="r.voidReason" class="void-reason">作废原因：{{ r.voidReason }}</small>
      </div>
      <div class="actions">
        <template v-if="r.status === '预留中'">
          <button class="primary" @click="onConfirm(r)">确认占用（制片）</button>
          <button class="secondary" @click="onRelease(r)">释放</button>
        </template>
        <template v-else-if="r.status === '已作废'">
          <button class="primary" @click="onReconfirm(r)">重新确认（制片）</button>
        </template>
      </div>
    </article>
  </section>
</template>

<style scoped>
.hold { border: 1px solid var(--line); border-radius: 12px; padding: 13px; margin-bottom: 10px; background: #fbfcfe; display: grid; gap: 8px; }
.hold.预留中 { border-color: #f0c6a8; background: #fff7f0; }
.hold.已确认 { border-color: #bfe3cf; background: #f2fbf6; }
.hold.已释放 { border-color: var(--line); background: #f4f5f7; opacity: .75; }
.hold.已作废 { border-color: #f2c1b5; background: #fff8f5; }
.hold-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.hold-code { color: var(--accent); font-weight: 900; }
.hold-title { font-weight: 700; }
.hold-countdown { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 700; color: #96600d; background: #fff0d4; padding: 3px 9px; border-radius: 99px; font-size: 13px; }
.hold-formal { margin-left: auto; color: #19704b; background: #dff3e8; padding: 3px 9px; border-radius: 99px; font-size: 13px; }
.hold-slot { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 13px; color: var(--ink); }
.hold-meta { display: flex; flex-wrap: wrap; gap: 6px 16px; }
.void-reason { color: #c84545; font-weight: 600; }
.status.预留中 { background: #ffe6d1; color: #b3541e; }
.status.已确认 { background: #dff3e8; color: #19704b; }
.status.已释放 { background: #e8edf4; color: #68758b; }
.status.已作废 { background: #fde2dc; color: #c84545; }
</style>

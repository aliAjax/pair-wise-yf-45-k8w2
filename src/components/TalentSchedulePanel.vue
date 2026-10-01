<script setup lang="ts">
import { reactive } from "vue";
import { ElMessage } from "element-plus";
import dayjs from "dayjs";
import { useScheduleStore } from "../stores/schedule";

const store = useScheduleStore();
const drafts = reactive<Record<string, string>>({});

function currentNote(talentId: string) {
  return store.talentSchedules.find((item) => item.talentId === talentId)?.note ?? "";
}

function save(talentId: string) {
  const note = (drafts[talentId] ?? currentNote(talentId)).trim();
  if (!note) {
    ElMessage.warning("请填写档期说明");
    return;
  }
  const result = store.modifyTalentSchedule(talentId, note);
  ElMessage.success(result.message);
  drafts[talentId] = "";
}
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>演员档期</h2>
        <small class="muted">预留期间改动档期，相关预留立即作废，需重新确认</small>
      </div>
    </div>
    <div v-for="t in store.talents" :key="t.id" class="sched-row">
      <div class="sched-head">
        <b>{{ t.name }}</b><small>{{ t.role }}</small>
      </div>
      <div class="sched-body">
        <input
          :placeholder="currentNote(t.id) || '填写档期，如：10月8日 全天'"
          v-model="drafts[t.id]"
          @keyup.enter="save(t.id)"
        />
        <button class="secondary" @click="save(t.id)">改动档期</button>
      </div>
      <small class="muted">当前：{{ currentNote(t.id) || "未设置" }} · 更新于 {{ dayjs(store.talentSchedules.find((i) => i.talentId === t.id)?.updatedAt).format("MM-DD HH:mm") }}</small>
    </div>
  </section>
</template>

<style scoped>
.sched-row { display: grid; gap: 6px; padding: 11px 0; border-bottom: 1px solid var(--line); }
.sched-row:last-child { border-bottom: 0; }
.sched-head { display: flex; align-items: baseline; gap: 8px; }
.sched-head small { color: var(--muted); }
.sched-body { display: flex; gap: 8px; }
.sched-body input { flex: 1; min-width: 0; border: 1px solid #cfd7e5; border-radius: 9px; padding: 9px 11px; background: #fafbfd; color: var(--ink); outline: none; font: inherit; }
.sched-body input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(242,95,58,.12); }
</style>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import dayjs from "dayjs";
import { ElMessage } from "element-plus";
import { toTypedSchema } from "@vee-validate/zod";
import { useForm } from "vee-validate";
import { z } from "zod";
import { RouterLink } from "vue-router";
import { useScheduleStore } from "../stores/schedule";
import type { BlockedResource, Hold, Scene, SceneStatus } from "../types";

const store = useScheduleStore();
const saving = ref(false);
const dragging = ref<number | null>(null);
const blocked = ref<BlockedResource[]>([]);
const form = reactive({ code: "", title: "", day: "2026-10-08", start: "08:00", end: "10:00", locationId: "l1", talentIds: [] as string[], equipmentIds: [] as string[] });
const schema = toTypedSchema(z.object({
  code: z.string().min(2, "请输入场次编号"),
  title: z.string().min(2, "请输入场次名称"),
  day: z.string().min(1),
  start: z.string().min(1),
  end: z.string().min(1),
  locationId: z.string().min(1)
}));
const { errors, validate } = useForm({ validationSchema: schema });
const canEdit = computed(() => store.role === "制片" || store.role === "导演");
const canReserve = computed(() => store.role === "制片" || store.role === "演员统筹");
const currentStatus = (status: string) => status as SceneStatus;

onMounted(() => store.loadDraft());

function resetForm() {
  Object.assign(form, { code: "", title: "", day: "2026-10-08", start: "08:00", end: "10:00", locationId: "l1", talentIds: [], equipmentIds: [] });
}

async function submit() {
  const result = await validate({ values: form } as any);
  if (!result.valid) return;
  saving.value = true;
  blocked.value = [];
  // 提交场次即开预留单：演员、场地、器材一起占，抢不到整笔退回
  const reservation = store.submitReservation({
    code: form.code, title: form.title, day: form.day, start: form.start, end: form.end,
    locationId: form.locationId, talentIds: [...form.talentIds], equipmentIds: [...form.equipmentIds]
  });
  setTimeout(() => { saving.value = false; }, 240);
  if (!reservation.ok) {
    blocked.value = reservation.blocked;
    ElMessage.error(`预留没抢到：${reservation.blocked.length} 项资源被占，已整笔退回`);
    return;
  }
  ElMessage.success("资源已占住，4 小时内待制片确认");
  resetForm();
}

function advance(scene: Scene) {
  const next = scene.status === "草稿" ? "已确认" : scene.status === "已确认" ? "拍摄中" : "已完成";
  const result = store.updateStatus(scene.id, currentStatus(next));
  if (result && !result.ok) ElMessage.warning(result.reason ?? "当前状态不能推进");
}

function sceneHold(sceneId: string): Hold | undefined {
  return store.holdByScene(sceneId);
}

function drop(index: number) {
  if (dragging.value !== null && canEdit.value) store.moveScene(dragging.value, index);
  dragging.value = null;
}
</script>

<template>
  <section class="page">
    <div class="metrics">
      <article class="metric"><span>通告场次</span><strong>{{ store.scenes.length }}</strong></article>
      <article class="metric"><span>预留中待确认</span><strong>{{ store.pendingHolds.length }}</strong></article>
      <article class="metric"><span>已确认</span><strong>{{ store.scenes.filter((item: Scene) => item.status === '已确认').length }}</strong></article>
      <article class="metric"><span>版本快照</span><strong>{{ store.versions.length }}</strong></article>
    </div>
    <div v-if="store.draft" class="draft-banner">
      <span>发现 {{ dayjs(store.draft.savedAt).format("MM-DD HH:mm") }} 的离线草稿，共 {{ store.draft.scenes.length }} 个场次。</span>
      <div class="actions"><button class="secondary" @click="store.syncDraft">同步到正式通告</button></div>
    </div>
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><h2>新增场次（提交即预留）</h2><button class="secondary" @click="store.saveDraft">保存离线草稿</button></div>
        <form class="form-grid" @submit.prevent="submit">
          <label class="field"><span>场次编号</span><input v-model="form.code" placeholder="C-018" /><small>{{ errors.code }}</small></label>
          <label class="field"><span>场次名称</span><input v-model="form.title" placeholder="例如：雨夜追踪" /><small>{{ errors.title }}</small></label>
          <label class="field"><span>拍摄日</span><input v-model="form.day" type="date" /></label>
          <label class="field"><span>场地</span><select v-model="form.locationId"><option v-for="item in store.locations" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
          <label class="field"><span>开始</span><input v-model="form.start" type="time" /></label>
          <label class="field"><span>结束</span><input v-model="form.end" type="time" /></label>
          <label class="field wide"><span>演员档期</span><select v-model="form.talentIds" multiple><option v-for="item in store.talents" :key="item.id" :value="item.id">{{ item.name }} · {{ item.role }}</option></select></label>
          <label class="field wide"><span>器材借用</span><select v-model="form.equipmentIds" multiple><option v-for="item in store.equipment" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
          <div class="actions wide">
            <button class="primary" type="submit" :disabled="saving || !canReserve">提交并占住资源</button>
            <RouterLink class="secondary" to="/reservations">去预留流程确认</RouterLink>
            <RouterLink class="secondary" to="/conflicts">检查冲突</RouterLink>
          </div>
          <p v-if="!canReserve" class="wide muted" style="margin:0">导演/场记不能提交预留，请切换为制片或演员统筹。</p>
        </form>
        <div v-if="blocked.length" class="blocked-panel" style="margin-top:14px">
          <b>没抢到，整笔退回（资源未被占用）：</b>
          <ul class="blocked-list">
            <li v-for="(item,index) in blocked" :key="`${item.type}-${item.resourceId}-${index}`">
              <b>{{ item.type }} · {{ item.resourceName }}</b>
              <span>被 <em>{{ item.holderOperator }}</em> 的场次 {{ item.holderSceneCode }} 占着
                <template v-if="item.holderStatus === '预留中'">（{{ dayjs(item.holderExpiresAt).format('MM-DD HH:mm') }} 前不确认会释放）</template>
                <template v-else>（已正式占用）</template>
              </span>
            </li>
          </ul>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>当日通告顺序</h2><small class="muted">提交即预留演员/场地/器材；制片在预留流程确认后才转正式占用</small></div><button class="primary" :disabled="!canEdit" @click="store.snapshot()">保存版本</button></div>
        <div class="scene-list">
          <article v-for="(scene,index) in store.sortedScenes" :key="scene.id" class="scene" :class="{ locked: scene.locked, dragging: dragging === index }" draggable="true" @dragstart="dragging=index" @dragover.prevent @drop="drop(index)">
            <b>{{ index + 1 }}</b>
            <div class="scene-code">{{ scene.code }}</div>
            <div class="scene-title">
              <b>{{ scene.title }}</b>
              <small>{{ scene.start }}–{{ scene.end }} · {{ store.locationName(scene.locationId) }}</small>
              <small v-if="sceneHold(scene.id)">
                <span class="hold-status" :class="sceneHold(scene.id)!.status">{{ sceneHold(scene.id)!.status }}</span>
                <template v-if="sceneHold(scene.id)!.status === '预留中'"> · 剩 {{ store.formatRemaining(sceneHold(scene.id)!) }}</template>
              </small>
            </div>
            <span class="status" :class="scene.status">{{ scene.status }}</span>
            <div class="actions">
              <button class="secondary" :disabled="!canEdit || scene.locked" @click="advance(scene)">推进</button>
              <button class="secondary" :disabled="!canEdit" @click="store.toggleLock(scene.id)">{{ scene.locked ? "解锁" : "锁定" }}</button>
            </div>
            <div class="scene-meta wide">
              <small>演员：{{ store.talentNames(scene.talentIds).join("、") || "待定" }} · 器材：{{ store.equipmentNames(scene.equipmentIds).join("、") || "无" }}</small>
            </div>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>

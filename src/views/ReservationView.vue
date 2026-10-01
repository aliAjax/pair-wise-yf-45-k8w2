<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import dayjs from "dayjs";
import { ElMessage } from "element-plus";
import { useScheduleStore } from "../stores/schedule";
import type { BlockedResource, Hold } from "../types";

const store = useScheduleStore();

const form = reactive({
  code: "",
  title: "",
  day: "2026-10-08",
  start: "08:00",
  end: "10:00",
  locationId: "l1",
  talentIds: [] as string[],
  equipmentIds: [] as string[]
});
const blocked = ref<BlockedResource[]>([]);
const lastResultHold = ref<Hold | null>(null);

const scheduleForm = reactive({ talentId: "t1", day: "2026-10-08", reason: "" });

const canSubmit = computed(() => store.role === "制片" || store.role === "演员统筹");
const isProducer = computed(() => store.role === "制片");

function blockedText(item: BlockedResource) {
  const status = item.holderStatus === "预留中"
    ? `预留中（${dayjs(item.holderExpiresAt).format("HH:mm")} 前不确认会释放）`
    : "已确认正式占用";
  return `${item.resourceName} 被 ${item.holderOperator} 的场次 ${item.holderSceneCode} ${status}`;
}

function submit() {
  if (!form.code.trim() || !form.title.trim()) {
    ElMessage.warning("请先填写场次编号和名称");
    return;
  }
  blocked.value = [];
  lastResultHold.value = null;
  const result = store.submitReservation({
    code: form.code.trim(),
    title: form.title.trim(),
    day: form.day,
    start: form.start,
    end: form.end,
    locationId: form.locationId,
    talentIds: [...form.talentIds],
    equipmentIds: [...form.equipmentIds]
  });
  if (!result.ok) {
    blocked.value = result.blocked;
    ElMessage.error(`没抢到：${result.blocked.length} 项资源被占，整笔退回`);
    return;
  }
  lastResultHold.value = store.holds.find((item) => item.id === result.holdId) ?? null;
  ElMessage.success("已占住演员、场地和器材，等待制片确认（4小时内有效）");
  Object.assign(form, { code: "", title: "", day: "2026-10-08", start: "08:00", end: "10:00", locationId: "l1", talentIds: [], equipmentIds: [] });
}

function confirm(hold: Hold) {
  const result = store.confirmReservation(hold.id);
  if (result.ok) ElMessage.success(`${hold.code} 已转为正式占用`);
  else ElMessage.error(result.reason ?? "确认失败");
}

function release(hold: Hold) {
  const result = store.releaseReservation(hold.id);
  if (result.ok) ElMessage.success(`${hold.code} 已释放，别人可以接上`);
  else ElMessage.error(result.reason ?? "释放失败");
}

function reReserve(hold: Hold) {
  const result = store.reReserve(hold.sceneId);
  if (result.ok) {
    ElMessage.success(`${hold.code} 已重新占住，需要制片再次确认`);
  } else if (result.blocked?.length) {
    blocked.value = result.blocked;
    ElMessage.error("资源已经被别人接上，退回清单见左侧");
  } else {
    ElMessage.error(result.reason ?? "重新预留失败");
  }
}

function changeSchedule() {
  if (!scheduleForm.reason.trim()) {
    ElMessage.warning("请填写档期改动原因");
    return;
  }
  const result = store.changeTalentSchedule(scheduleForm.talentId, scheduleForm.day, scheduleForm.reason.trim());
  if (!result.ok) {
    ElMessage.error(result.reason ?? "档期改动被挡回");
    return;
  }
  ElMessage.success(result.voidedIds.length
    ? `档期已改动，${result.voidedIds.length} 张预留立即作废，需重新确认`
    : "档期已改动，当天没有待确认的预留");
  scheduleForm.reason = "";
}

function resourceSummary(hold: Hold) {
  return hold.resources.map((res) => store.resourceName(res.type, res.resourceId)).join("、");
}
</script>

<template>
  <section class="page">
    <div class="metrics">
      <article class="metric"><span>预留中（待制片确认）</span><strong>{{ store.pendingHolds.length }}</strong></article>
      <article class="metric"><span>正式占用</span><strong>{{ store.activeHolds.filter((h) => h.status === '已确认').length }}</strong></article>
      <article class="metric"><span>已释放</span><strong>{{ store.holds.filter((h) => h.status === '已释放').length }}</strong></article>
      <article class="metric"><span>已作废</span><strong>{{ store.holds.filter((h) => h.status === '已作废').length }}</strong></article>
    </div>

    <div class="grid-2">
      <div class="side-col">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>提交预留</h2>
              <small class="muted">提交瞬间一次性占住演员+场地+器材；任一被占则整笔退回。当前提交人：<b>{{ store.operator }}</b>（{{ store.role }}）</small>
            </div>
          </div>
          <form class="form-grid" @submit.prevent="submit">
            <label class="field"><span>场次编号</span><input v-model="form.code" placeholder="C-018" /></label>
            <label class="field"><span>场次名称</span><input v-model="form.title" placeholder="例如：雨夜追踪" /></label>
            <label class="field"><span>拍摄日</span><input v-model="form.day" type="date" /></label>
            <label class="field"><span>场地</span><select v-model="form.locationId"><option v-for="item in store.locations" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
            <label class="field"><span>开始</span><input v-model="form.start" type="time" /></label>
            <label class="field"><span>结束</span><input v-model="form.end" type="time" /></label>
            <label class="field wide"><span>演员（一起占住档期）</span>
              <select v-model="form.talentIds" multiple><option v-for="item in store.talents" :key="item.id" :value="item.id">{{ item.name }} · {{ item.role }}</option></select>
            </label>
            <label class="field wide"><span>器材（一起占用）</span>
              <select v-model="form.equipmentIds" multiple><option v-for="item in store.equipment" :key="item.id" :value="item.id">{{ item.name }}</option></select>
            </label>
            <div class="actions wide">
              <button class="primary" type="submit" :disabled="!canSubmit">提交并占住资源</button>
              <span v-if="!canSubmit" class="muted">导演/场记不能提交预留</span>
            </div>
          </form>
        </section>

        <section v-if="blocked.length" class="panel blocked-panel">
          <div class="panel-head"><h2>没抢到，整笔退回</h2><span class="seal-warn">{{ blocked.length }} 项被占</span></div>
          <ul class="blocked-list">
            <li v-for="(item, index) in blocked" :key="`${item.type}-${item.resourceId}-${index}`">
              <b>{{ item.type }} · {{ item.resourceName }}</b>
              <span>被 <em>{{ item.holderOperator }}</em> 占着 · 场次 {{ item.holderSceneCode }}
                <template v-if="item.holderStatus === '预留中'">（对方 {{ dayjs(item.holderExpiresAt).format('MM-DD HH:mm') }} 前不确认就释放，可届时再接）</template>
                <template v-else>（正式占用）</template>
              </span>
            </li>
          </ul>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div><h2>演员档期改动</h2><small class="muted">改动当天该演员所有「预留中」立即作废；正式占用不受影响</small></div>
          </div>
          <div class="form-grid">
            <label class="field"><span>演员</span>
              <select v-model="scheduleForm.talentId"><option v-for="item in store.talents" :key="item.id" :value="item.id">{{ item.name }} · {{ item.role }}</option></select>
            </label>
            <label class="field"><span>档期日期</span><input v-model="scheduleForm.day" type="date" /></label>
            <label class="field wide"><span>改动原因</span><input v-model="scheduleForm.reason" placeholder="例如：突发商演，白天档期外调" /></label>
            <div class="actions wide">
              <button class="danger" type="button" @click="changeSchedule" :disabled="store.role !== '演员统筹' && store.role !== '制片'">改动档期并作废旧预留</button>
            </div>
          </div>
        </section>

        <section class="panel clock-panel">
          <div class="panel-head"><h2>预留时钟</h2></div>
          <p class="muted" style="margin:0 0 10px">预留满 4 小时未确认自动释放。当前时间 {{ dayjs(store.now).format("MM-DD HH:mm:ss") }}（拨快仅用于演示）</p>
          <div class="actions">
            <button class="secondary" type="button" @click="store.advanceClock(1)">快进 1 小时</button>
            <button class="secondary" type="button" @click="store.advanceClock(4)">快进 4 小时</button>
            <button class="secondary" type="button" @click="store.resetClock">回到当前</button>
          </div>
        </section>
      </div>

      <section class="panel">
        <div class="panel-head">
          <div><h2>预留单队列</h2><small class="muted">预留中→制片确认转正式占用；超时自动释放；档期改动立即作废</small></div>
          <span class="status">待确认 {{ store.pendingHolds.length }} 张</span>
        </div>
        <div class="hold-list">
          <article v-for="hold in store.sortedHolds" :key="hold.id" class="hold-card" :class="`hold-${hold.status}`">
            <div class="hold-head">
              <div>
                <b>{{ hold.code }} {{ hold.title }}</b>
                <small>{{ hold.day }} {{ hold.start }}–{{ hold.end }} · {{ hold.operator }} 提交于 {{ dayjs(hold.createdAt).format('MM-DD HH:mm') }}</small>
              </div>
              <span class="hold-status" :class="hold.status">{{ hold.status }}</span>
            </div>
            <p class="hold-res"><span v-for="(res, i) in hold.resources" :key="i" class="res-chip">{{ res.type }}·{{ store.resourceName(res.type, res.resourceId) }}</span></p>
            <div class="hold-foot">
              <small class="muted">
                <template v-if="hold.status === '预留中'">剩余确认时间 <b class="countdown">{{ store.formatRemaining(hold) }}</b>（{{ dayjs(hold.expiresAt).format('MM-DD HH:mm') }} 到期释放）</template>
                <template v-else-if="hold.status === '已确认'">已于 {{ dayjs(hold.confirmedAt).format('MM-DD HH:mm') }} 转为正式占用</template>
                <template v-else-if="hold.status === '已释放'">{{ dayjs(hold.releasedAt).format('MM-DD HH:mm') }} 已释放，资源可被他人接上</template>
                <template v-else>{{ hold.voidReason }} · {{ dayjs(hold.createdAt).format('MM-DD HH:mm') }} 作废</template>
              </small>
              <div class="actions">
                <button v-if="hold.status === '预留中'" class="primary" :disabled="!isProducer" @click="confirm(hold)">制片确认</button>
                <button v-if="hold.status === '预留中'" class="secondary" :disabled="store.role !== '制片' && hold.operator !== store.operator" @click="release(hold)">退回释放</button>
                <button v-if="hold.status === '已释放' || hold.status === '已作废'" class="secondary" :disabled="!canSubmit" @click="reReserve(hold)">重新预留</button>
                <span v-if="hold.status === '预留中' && !isProducer" class="muted">仅制片可确认</span>
              </div>
            </div>
          </article>
          <el-empty v-if="!store.holds.length" description="还没有预留单" />
        </div>
      </section>
    </div>
  </section>
</template>

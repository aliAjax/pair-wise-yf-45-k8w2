export type Role = "制片" | "导演" | "演员统筹" | "场记";
export type SceneStatus = "草稿" | "已确认" | "拍摄中" | "已完成";
export type ConflictType = "演员档期" | "场地占用" | "器材借用" | "转场时间";

export type HoldStatus = "预留中" | "已确认" | "已释放" | "已作废";
export type HoldResourceType = "演员" | "场地" | "器材";

export interface Talent {
  id: string;
  name: string;
  role: string;
}

export interface Location {
  id: string;
  name: string;
}

export interface Equipment {
  id: string;
  name: string;
}

export interface Scene {
  id: string;
  code: string;
  title: string;
  day: string;
  start: string;
  end: string;
  talentIds: string[];
  locationId: string;
  equipmentIds: string[];
  status: SceneStatus;
  locked: boolean;
  reservationId?: string;
}

export interface HoldResource {
  type: HoldResourceType;
  resourceId: string;
}

/** 预留被挡回时，逐项说明资源被谁占着 */
export interface BlockedResource extends HoldResource {
  resourceName: string;
  holderHoldId: string;
  holderSceneId: string;
  holderSceneCode: string;
  holderOperator: string;
  holderStatus: HoldStatus;
  holderExpiresAt?: string;
}

/** 一张预留单：提交场次时原子占用的演员、场地、器材 */
export interface Hold {
  id: string;
  sceneId: string;
  code: string;
  title: string;
  day: string;
  start: string;
  end: string;
  resources: HoldResource[];
  operator: string;
  status: HoldStatus;
  createdAt: string;
  expiresAt: string;
  confirmedAt?: string;
  releasedAt?: string;
  voidReason?: string;
}

export interface TalentScheduleChange {
  id: string;
  talentId: string;
  day: string;
  reason: string;
  operator: string;
  time: string;
}

export type ReservationInput = Omit<Scene, "id" | "status" | "locked" | "reservationId">;

export type SubmitResult =
  | { ok: true; holdId: string; sceneId: string }
  | { ok: false; blocked: BlockedResource[] };

export interface HoldActionResult {
  ok: boolean;
  holdId?: string;
  blocked?: BlockedResource[];
  reason?: string;
}

export interface ScheduleChangeResult {
  ok: boolean;
  reason?: string;
  voidedIds: string[];
}

export interface Conflict {
  id: string;
  type: ConflictType;
  sceneIds: string[];
  message: string;
  severity: "高" | "中";
}

export interface HistoryEntry {
  id: string;
  action: string;
  detail: string;
  time: string;
}

export interface Version {
  id: string;
  name: string;
  time: string;
  scenes: Scene[];
}

export interface OfflineDraft {
  scenes: Scene[];
  savedAt: string;
}

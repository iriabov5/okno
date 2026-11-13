export type Role = 'ENGINEER' | 'OWNER' | 'OPERATIONS' | 'DUTY' | 'QA' | 'ADMIN';
export type WorkStatus = 'TO_DO' | 'IN_PROGRESS' | 'IN_TEST' | 'READY';
export type ReleaseStatus = 'DRAFT' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'DEPLOYED';
export type Stage = 'OWNER' | 'OPERATIONS' | 'DUTY';

export interface PersonRef {
  id: string;
  displayName: string;
}
export interface Person extends PersonRef {
  role: Role;
}
export interface System {
  id: string;
  code: string;
  name: string;
}
export interface Window {
  startsAt: string;
  endsAt: string;
}
export interface CalendarConflict extends Window {
  resource: string;
  description: string;
}
export interface CalendarPreview {
  conflicts: CalendarConflict[];
  suggestedWindow: Window | null;
  route?: Stage[];
}
export interface ReleaseLink {
  id: string | null;
  key: string;
  status: ReleaseStatus;
  startsAt: string | null;
  endsAt: string | null;
  deployedAt: string | null;
}
export type WorkType = 'TASK' | 'STORY' | 'BUG';
export type Priority = 'HIGH' | 'NORMAL' | 'LOW';
export interface SprintRef {
  id: string;
  name: string;
  state: 'PLANNED' | 'ACTIVE' | 'CLOSED';
}
export interface Sprint extends SprintRef {
  goal: string;
  startsOn: string;
  endsOn: string;
  revision: number;
  itemCount: number;
  readyCount: number;
}
export interface Epic {
  id: string;
  title: string;
  goal: string;
  systemId: string;
  itemCount: number;
  readyCount: number;
}
export interface WorkItem {
  type: WorkType;
  priority: Priority;
  epic: Pick<Epic, 'id' | 'title'> | null;
  sprint: SprintRef | null;
  id: string;
  key: string;
  systemId: string;
  title: string;
  description: string | null;
  assignee: PersonRef | null;
  reviewer: PersonRef | null;
  canClaimReview: boolean;
  requiredItem: { id: string; key: string; title: string } | null;
  status: WorkStatus;
  revision: number;
  allowedTransitions: WorkStatus[];
  plannedReleases: ReleaseLink[];
  deployedRelease: ReleaseLink | null;
  history?: WorkEvent[];
}

export type ReleaseWorkEventKind =
  'RELEASE_SUBMITTED' | 'RELEASE_ADDED' | 'RELEASE_REMOVED' | 'RELEASE_DEPLOYED';

interface WorkEventDetails {
  id: string;
  occurredAt: string;
  actor: string | null;
}

export type WorkEvent = WorkEventDetails &
  (
    | {
        kind: 'CREATED' | 'ASSIGNMENT' | 'REVIEW_CLAIMED' | 'STATUS';
        fromStatus: WorkStatus;
        toStatus: WorkStatus;
        previousAssignee: string | null;
        nextAssignee: string | null;
        releaseKey: null;
      }
    | {
        kind: 'SPRINT_CHANGED';
        releaseKey: null;
        toStatus: WorkStatus;
        fromSprint: Pick<SprintRef, 'name'> | null;
        toSprint: Pick<SprintRef, 'name'> | null;
      }
    | { kind: ReleaseWorkEventKind; releaseKey: string }
  );

export interface WorkFormData {
  type: WorkType;
  priority: Priority;
  epicId: string | null;
  systemId: string;
  title: string;
  description: string | null;
  assigneeId: string | null;
  requiredItemId: string | null;
}
export interface Blocker {
  key: string | null;
  code: string;
  assignee?: string | null;
  message: string;
}
export interface Dependency {
  key: string;
  requiredKey: string;
  release: string | null;
  included: boolean;
}
export interface ScopePreview {
  blockers: Blocker[];
  dependencies: Dependency[];
}
export interface ReleaseSummary extends Omit<ReleaseLink, 'id'> {
  id: string;
  title: string | null;
  revision: number;
  systemName: string | null;
  taskId?: string;
  stage?: Stage;
}
export interface ReleaseCard extends Omit<ReleaseSummary, 'systemName'>, ScopePreview {
  system: System | null;
  author: PersonRef | null;
  rollbackPlan: string | null;
  gitlabTagUrl: string | null;
  gitlabReleaseUrl: string | null;
  items: { key: string; title: string; sprint: SprintRef | null }[];
  currentAssignee: PersonRef | null;
  currentTaskId: string | null;
  availableActions: string[];
  route: { stage: Stage; label: string; state: string; assignee: PersonRef | null }[];
  calendarConflicts: CalendarConflict[];
  suggestedWindow: Window | null;
  history: { createdAt: string; actor: string; type: string; details: Record<string, unknown> }[];
}
export interface ChangePreview extends ScopePreview {
  revision: number;
  calendar: CalendarPreview;
  steps: { stage: Stage; effect: string; reason: string }[];
  nextAssignee: PersonRef | null;
  previousWindow: Window;
  window: Window;
  previousTag: string | null;
  gitlabTagUrl: string | null;
  addedItemKeys: string[];
  removedItemKeys: string[];
}

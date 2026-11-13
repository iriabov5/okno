export const roles = ['ENGINEER', 'OWNER', 'OPERATIONS', 'DUTY', 'QA', 'ADMIN'] as const;
export type Role = (typeof roles)[number];

export interface Person {
  id: string;
  displayName: string;
  role: Role;
}

export interface SystemRow {
  id: string;
  code: string;
  name: string;
  owner_id: string;
  operations_id: string;
  duty_id: string;
}

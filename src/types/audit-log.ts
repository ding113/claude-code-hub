export type AuditCategory =
  | "auth"
  | "user"
  | "provider"
  | "provider_group"
  | "system_settings"
  | "key"
  | "notification"
  | "sensitive_word"
  | "model_price";

export interface AuditLogInput {
  actionCategory: AuditCategory;
  actionType: string;
  targetType?: string | null;
  targetId?: string | null;
  targetName?: string | null;
  beforeValue?: unknown;
  afterValue?: unknown;
  operatorUserId?: number | null;
  operatorUserName?: string | null;
  operatorKeyId?: number | null;
  operatorKeyName?: string | null;
  operatorIp?: string | null;
  userAgent?: string | null;
  success: boolean;
  errorMessage?: string | null;
}

export interface AuditLogRow {
  id: number;
  actionCategory: AuditCategory;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  beforeValue: unknown | null;
  afterValue: unknown | null;
  operatorUserId: number | null;
  operatorUserName: string | null;
  operatorKeyId: number | null;
  operatorKeyName: string | null;
  operatorIp: string | null;
  userAgent: string | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: Date;
}

export interface AuditLogFilter {
  category?: AuditCategory;
  actionType?: string;
  operatorUserId?: number;
  operatorIp?: string;
  targetType?: string;
  targetId?: string;
  success?: boolean;
  from?: Date;
  to?: Date;
}

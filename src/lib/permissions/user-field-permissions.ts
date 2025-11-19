/**
 * User Field Permissions Configuration
 *
 * Defines role-based access control for user fields.
 * This configuration determines which fields require specific roles to modify.
 */

export const USER_FIELD_PERMISSIONS = {
  // Admin-only fields (existing sensitive fields)
  rpmLimit: { requiredRole: "admin" },
  dailyLimitUsd: { requiredRole: "admin" },
  providerGroup: { requiredRole: "admin" },

  // Admin-only fields (new user-level quota fields)
  limit5hUsd: { requiredRole: "admin" },
  limitWeeklyUsd: { requiredRole: "admin" },
  limitMonthlyUsd: { requiredRole: "admin" },
  limitConcurrentSessions: { requiredRole: "admin" },
} as const;

/**
 * Check if a user has permission to modify a specific field
 *
 * @param field - The field name to check
 * @param userRole - The user's role (e.g., 'admin', 'user')
 * @returns true if the user has permission, false otherwise
 */
export function checkFieldPermission(field: string, userRole: string): boolean {
  const permission = USER_FIELD_PERMISSIONS[field as keyof typeof USER_FIELD_PERMISSIONS];

  // If no permission is defined for the field, allow modification
  if (!permission) return true;

  // Check if user's role matches the required role
  return userRole === permission.requiredRole;
}

/**
 * Get all unauthorized fields from a data object based on user role
 *
 * @param data - The data object containing fields to check
 * @param userRole - The user's role
 * @returns Array of field names that the user is not authorized to modify
 */
export function getUnauthorizedFields(data: Record<string, unknown>, userRole: string): string[] {
  return Object.keys(data).filter((field) => !checkFieldPermission(field, userRole));
}

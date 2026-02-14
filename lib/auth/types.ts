/**
 * Role hierarchy: viewer < user < admin < superAdmin
 * Used for RBAC (Phase 2+). Until blocking function sets claims, role may be undefined.
 */
export type Role = "viewer" | "user" | "admin" | "superAdmin";

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  /** Set by blocking function / bootstrap; undefined until Phase 2 */
  role?: Role;
  /** Set by blocking function; null for superAdmin */
  orgId?: string | null;
  /** Set by bootstrap for Super Admin only */
  superAdmin?: boolean;
}

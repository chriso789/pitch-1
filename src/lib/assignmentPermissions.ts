/**
 * Who a user is allowed to assign a contact / lead / project to.
 *
 * Rules:
 *  - Sales reps (role `project_manager`) can never hand a new lead/customer to
 *    someone else. The record is always assigned to them.
 *  - A sales rep may add ONE additional sales rep (a co-assignee / split), but
 *    never a manager, sales manager, owner, corporate or office admin.
 *  - Managers, sales managers, regional managers, corporate, owners and COB
 *    may choose any rep as the primary assignee.
 *  - Splits are always rep-to-rep: only sales reps can be added as the
 *    secondary assignee, for anyone doing the assigning.
 */

/** Roles treated as "sales rep" for assignment purposes. */
export const SALES_REP_ROLES = ['project_manager'] as const;

export const isSalesRepRole = (role?: string | null): boolean =>
  !!role && (SALES_REP_ROLES as readonly string[]).includes(role);

/** Can this role pick somebody other than themselves as primary assignee? */
export const canAssignToOthers = (role?: string | null): boolean =>
  !!role && !isSalesRepRole(role);

interface AssignableUser {
  id: string;
  role?: string | null;
}

/**
 * Options available for the PRIMARY assignee.
 * Sales reps only ever see themselves.
 */
export function filterPrimaryAssignees<T extends AssignableUser>(
  users: T[],
  currentUserRole?: string | null,
  currentUserId?: string | null
): T[] {
  if (canAssignToOthers(currentUserRole)) return users;
  return users.filter((u) => u.id === currentUserId);
}

/**
 * Options available for an ADDITIONAL (split) assignee.
 * Always restricted to sales reps, and never the current primary.
 */
export function filterSecondaryAssignees<T extends AssignableUser>(
  users: T[],
  alreadyAssignedIds: string[] = []
): T[] {
  return users.filter(
    (u) => isSalesRepRole(u.role) && !alreadyAssignedIds.includes(u.id)
  );
}

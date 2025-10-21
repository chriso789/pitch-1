// Role hierarchy and utilities

export const ROLE_HIERARCHY = {
  master: 1,
  corporate: 2,
  office_admin: 3,
  regional_manager: 4,
  sales_manager: 5,
  project_manager: 6
} as const;

export type AppRole = keyof typeof ROLE_HIERARCHY;

export const ROLE_DISPLAY_NAMES: Record<AppRole, string> = {
  master: 'Master',
  corporate: 'Corporate',
  office_admin: 'Office Admin',
  regional_manager: 'Regional Manager',
  sales_manager: 'Sales Manager',
  project_manager: 'Project Manager'
};

export const getRoleDisplayName = (role: string): string => {
  return ROLE_DISPLAY_NAMES[role as AppRole] || role;
};

export const getRoleLevel = (role: string): number => {
  return ROLE_HIERARCHY[role as AppRole] || 999;
};

export const canEditRole = (currentRole: string, targetRole: string): boolean => {
  if (currentRole === 'master') return true;
  const currentLevel = getRoleLevel(currentRole);
  const targetLevel = getRoleLevel(targetRole);
  return currentLevel < targetLevel;
};

export const canDeleteRole = (currentRole: string, targetRole: string): boolean => {
  return canEditRole(currentRole, targetRole);
};

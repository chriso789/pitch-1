// Role hierarchy and utilities

export const ROLE_HIERARCHY = {
  master: 1,
  owner: 2,
  corporate: 3,
  office_admin: 4,
  regional_manager: 5,
  sales_manager: 6,
  project_manager: 7
} as const;

export type AppRole = keyof typeof ROLE_HIERARCHY;

export const ROLE_DISPLAY_NAMES: Record<AppRole, string> = {
  master: 'COB',
  owner: 'Owner',
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

export const canViewAllEstimates = (role: string): boolean => {
  // sales_manager (level 6) and above can see all estimates
  return getRoleLevel(role) <= 6;
};

export const canViewAllLeads = (role: string): boolean => {
  // Same logic - sales managers and above see everything
  return getRoleLevel(role) <= 6;
};

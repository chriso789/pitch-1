/**
 * Centralized Test IDs
 * Phase 1 - Week 1-2: Testing Infrastructure
 * 
 * Convention: {feature}-{component}-{action}
 * Examples:
 *   - auth-email-input
 *   - contacts-create-button
 *   - pipeline-card-edit
 */

export const TEST_IDS = {
  // Auth
  auth: {
    emailInput: 'auth-email-input',
    passwordInput: 'auth-password-input',
    firstNameInput: 'auth-firstname-input',
    lastNameInput: 'auth-lastname-input',
    submitButton: 'auth-submit-button',
    toggleMode: 'auth-toggle-mode',
    forgotPassword: 'auth-forgot-password',
    resetButton: 'auth-reset-button',
  },

  // Navigation
  sidebar: {
    dashboard: 'sidebar-dashboard',
    contacts: 'sidebar-contacts',
    pipeline: 'sidebar-pipeline',
    jobs: 'sidebar-jobs',
    estimates: 'sidebar-estimates',
    calendar: 'sidebar-calendar',
    settings: 'sidebar-settings',
    userMenu: 'sidebar-user-menu',
  },

  // User Menu
  userMenu: {
    profile: 'user-menu-profile',
    settings: 'user-menu-settings',
    logout: 'user-menu-logout',
  },

  // Contacts
  contacts: {
    createButton: 'contacts-create-button',
    searchInput: 'contacts-search-input',
    filterType: 'contacts-filter-type',
    listItem: 'contacts-list-item',
    editButton: 'contacts-edit-button',
    deleteButton: 'contacts-delete-button',
    form: {
      firstName: 'contact-form-firstname',
      lastName: 'contact-form-lastname',
      email: 'contact-form-email',
      phone: 'contact-form-phone',
      leadSource: 'contact-form-lead-source',
      address: 'contact-form-address',
      submit: 'contact-form-submit',
      cancel: 'contact-form-cancel',
    },
  },

  // Pipeline
  pipeline: {
    kanban: 'pipeline-kanban',
    column: 'pipeline-column',
    card: 'pipeline-card',
    createButton: 'pipeline-create-button',
    dragHandle: 'pipeline-drag-handle',
    viewDetails: 'pipeline-view-details',
    editButton: 'pipeline-edit-button',
    deleteButton: 'pipeline-delete-button',
  },

  // Settings
  settings: {
    generalTab: 'settings-general-tab',
    usersTab: 'settings-users-tab',
    rolesTab: 'settings-roles-tab',
    apiTab: 'settings-api-tab',
    saveButton: 'settings-save-button',
    cancelButton: 'settings-cancel-button',
  },

  // Jobs
  jobs: {
    createButton: 'jobs-create-button',
    searchInput: 'jobs-search-input',
    filterStatus: 'jobs-filter-status',
    listItem: 'jobs-list-item',
    viewButton: 'jobs-view-button',
  },

  // Estimates
  estimates: {
    createButton: 'estimates-create-button',
    lineItemAdd: 'estimates-line-item-add',
    lineItemRemove: 'estimates-line-item-remove',
    saveButton: 'estimates-save-button',
    sendButton: 'estimates-send-button',
  },

  // Tasks
  tasks: {
    createButton: 'task-create-button',
    titleInput: 'task-title-input',
    descriptionInput: 'task-description-input',
    prioritySelect: 'task-priority-select',
    dueDateInput: 'task-due-date-input',
    assignToSelect: 'task-assign-to-select',
    submitButton: 'task-submit-button',
    cancelButton: 'task-cancel-button',
  },

  // Generic actions (can be combined with feature prefix)
  actions: {
    save: 'action-save',
    cancel: 'action-cancel',
    delete: 'action-delete',
    edit: 'action-edit',
    create: 'action-create',
    submit: 'action-submit',
    close: 'action-close',
  },
} as const;

/**
 * Build test ID from parts
 */
export function buildTestId(...parts: string[]): string {
  return parts.filter(Boolean).join('-');
}

/**
 * Get test ID attribute object
 */
export function testId(id: string) {
  return { 'data-testid': id };
}

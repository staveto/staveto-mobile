/** Firestore path helpers for catalog and projects. */
export const paths = {
  catalogTemplate: (id: string) => `catalogTemplates/${id}`,
  catalogPhases: (templateId: string) => `catalogTemplates/${templateId}/phases`,
  catalogPhase: (templateId: string, phaseId: string) =>
    `catalogTemplates/${templateId}/phases/${phaseId}`,
  catalogTasks: (templateId: string) => `catalogTemplates/${templateId}/tasks`,
  catalogTask: (templateId: string, taskId: string) =>
    `catalogTemplates/${templateId}/tasks/${taskId}`,
  project: (id: string) => `projects/${id}`,
  projectMembers: (projectId: string) => `projects/${projectId}/members`,
  projectMember: (projectId: string, userId: string) =>
    `projects/${projectId}/members/${userId}`,
  projectMembersByUid: (projectId: string) => `projects/${projectId}/membersByUid`,
  projectMemberByUid: (projectId: string, uid: string) =>
    `projects/${projectId}/membersByUid/${uid}`,
  projectPhases: (projectId: string) => `projects/${projectId}/phases`,
  projectPhase: (projectId: string, phaseId: string) =>
    `projects/${projectId}/phases/${phaseId}`,
  projectTasks: (projectId: string) => `projects/${projectId}/tasks`,
  projectTask: (projectId: string, taskId: string) =>
    `projects/${projectId}/tasks/${taskId}`,
  projectStats: (projectId: string) => `projects/${projectId}/stats`,
  projectPhaseStats: (projectId: string, phaseId: string) =>
    `projects/${projectId}/phaseStats/${phaseId}`,
  projectAttachments: (projectId: string) => `projects/${projectId}/attachments`,
  projectAttachment: (projectId: string, attachmentId: string) =>
    `projects/${projectId}/attachments/${attachmentId}`,
  projectEvents: (projectId: string) => `projects/${projectId}/events`,
  // DEPRECATED: Use projectAttachments with taskId in metadata instead
  // @deprecated Use projectAttachments(projectId) and filter by taskId metadata
  taskAttachments: (projectId: string, taskId: string) =>
    `projects/${projectId}/tasks/${taskId}/attachments`,
  // DEPRECATED: Use projectAttachment(projectId, attachmentId) with taskId in metadata instead
  // @deprecated Use projectAttachment(projectId, attachmentId) with taskId metadata
  taskAttachment: (projectId: string, taskId: string, attachmentId: string) =>
    `projects/${projectId}/tasks/${taskId}/attachments/${attachmentId}`,
  // Expenses (MVP)
  projectExpenses: (projectId: string) => `projects/${projectId}/expenses`,
  projectExpense: (projectId: string, expenseId: string) =>
    `projects/${projectId}/expenses/${expenseId}`,
  // Construction Diary (BUILD projects)
  constructionDiary: (projectId: string) => `projects/${projectId}/constructionDiary`,
  constructionDiaryEntry: (projectId: string, entryId: string) =>
    `projects/${projectId}/constructionDiary/${entryId}`,
  // Project Documents (BUILD projects)
  projectDocuments: (projectId: string) => `projects/${projectId}/documents`,
  projectDocument: (projectId: string, documentId: string) =>
    `projects/${projectId}/documents/${documentId}`,
  // Problems / Defects (all project types)
  projectProblems: (projectId: string) => `projects/${projectId}/problems`,
  projectProblem: (projectId: string, problemId: string) =>
    `projects/${projectId}/problems/${problemId}`,
  // Equipment (MAINTENANCE v2)
  projectEquipment: (projectId: string) => `projects/${projectId}/equipment`,
  projectEquipmentItem: (projectId: string, equipmentId: string) =>
    `projects/${projectId}/equipment/${equipmentId}`,
  // Service Rules (MAINTENANCE v2)
  projectServiceRules: (projectId: string) => `projects/${projectId}/serviceRules`,
  projectServiceRule: (projectId: string, ruleId: string) =>
    `projects/${projectId}/serviceRules/${ruleId}`,
  // Notifications (user-specific)
  userNotifications: (userId: string) => `users/${userId}/notifications`,
  userNotification: (userId: string, notificationId: string) =>
    `users/${userId}/notifications/${notificationId}`,
  userProjectState: (uid: string, projectId: string) =>
    `users/${uid}/projectState/${projectId}`,
  userProjectRefs: (uid: string) => `users/${uid}/projectRefs`,
  userProjectRef: (uid: string, projectId: string) =>
    `users/${uid}/projectRefs/${projectId}`,
  /** User-owned equipment (tools, machines) — not project subdocuments. */
  userEquipment: (uid: string) => `users/${uid}/equipment`,
  userEquipmentItem: (uid: string, equipmentId: string) =>
    `users/${uid}/equipment/${equipmentId}`,
  /** Service rules (plans) on user-owned equipment — same semantics as project serviceRules. */
  userEquipmentServiceRules: (uid: string, equipmentId: string) =>
    `users/${uid}/equipment/${equipmentId}/serviceRules`,
  userEquipmentServiceRule: (uid: string, equipmentId: string, ruleId: string) =>
    `users/${uid}/equipment/${equipmentId}/serviceRules/${ruleId}`,
  /** Open/done service work items for user equipment (not project tasks). */
  userEquipmentServiceTasks: (uid: string, equipmentId: string) =>
    `users/${uid}/equipment/${equipmentId}/serviceTasks`,
  userEquipmentServiceTask: (uid: string, equipmentId: string, taskId: string) =>
    `users/${uid}/equipment/${equipmentId}/serviceTasks/${taskId}`,
  // Time tracking
  userDoc: (uid: string) => `users/${uid}`,
  timeEntries: () => `timeEntries`,
  timeEntry: (id: string) => `timeEntries/${id}`,
  // Absences (vacation, sick leave, doctor visits, personal leave) — separate from timeEntries
  absences: () => `absences`,
  absence: (id: string) => `absences/${id}`,
  // ─────────────────────────────────────────────────────────────────────────
  // Staveto Business (B2B) — organizations & memberships. READ-ONLY use-sites
  // only in Phase 1; writes happen via Cloud Functions in later phases.
  organization: (orgId: string) => `organizations/${orgId}`,
  organizationMembers: (orgId: string) => `organizations/${orgId}/members`,
  organizationMember: (orgId: string, userId: string) =>
    `organizations/${orgId}/members/${userId}`,
  invites: () => `invites`,
  invite: (inviteId: string) => `invites/${inviteId}`,
};

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
  // Notifications (user-specific)
  userNotifications: (userId: string) => `users/${userId}/notifications`,
  userNotification: (userId: string, notificationId: string) =>
    `users/${userId}/notifications/${notificationId}`,
};

# Capabilities Core: Free / Personal Pro / Business

This document describes the centralized capability model introduced in
`src/lib/capabilities.ts`. The current phase is read-only and does not change
runtime behavior by itself.

## Purpose

- Keep one source of truth for feature eligibility.
- Prepare future UI gates and upgrade CTAs without touching existing flows yet.
- Preserve compatibility with existing legacy shared projects.

## Plans

- **Free**
  - Personal baseline features are available.
  - Team/business features are disabled in personal workspace.
- **Personal Pro**
  - Personal pro feature set is available.
  - Team/business features remain disabled in personal workspace.
- **Business**
  - Business capabilities are enabled only when all are true:
    - `activeBusinessOrgId` exists
    - `organization.status === "active"`
    - `organization.businessEnabled === true`
    - `membership.status === "active"`

## Workspace Types

Capability evaluation distinguishes:

- `personal`
- `business`
- `legacy`

When `project.workspaceType` is not explicitly available, the default is
`legacy` for safety and migration compatibility.

## Business-only Capabilities

Intended Business-only capabilities:

- `canInviteMembers`
- `canUseProjectMembers`
- `canUseProjectChat`
- `canUseBusinessProjects`
- `canUseAttendance`
- `canUseBusinessReports`
- `canManageEmployees`
- `canUseQrInvite`

For current migration safety, legacy workspaces keep transitional access for
existing collaboration primitives (`team features`, `invites`, `members`,
`attendance`) while `chat`, `business reports`, and `QR invite` stay disabled.

## Legacy Shared Projects

Legacy shared projects are treated as transitional:

- They should not break suddenly when capability checks are introduced.
- Capability defaults favor compatibility until explicit workspace migration is
  completed.
- A later phase can tighten legacy behavior behind controlled rollout.

## Next Phase Usage

In the next phase, UI entry points can call capability checks before opening:

- team/members/invite actions
- business-only features
- upgrade modals and CTA flows

Current phase does not wire capability checks into screens/services.

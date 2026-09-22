/** Authorization: permissions, principals, per-object policies, tenant scoping. */

export {
  ALL_PERMISSIONS,
  Permission,
  ROLE_PERMISSIONS,
  codeDefault,
  resolve,
  roleValue,
} from "@/lib/policies/permissions";
export { Principal, loadPrincipal, type PrincipalFields } from "@/lib/policies/principal";
export { fetchScoped, scoped, type TenantScope } from "@/lib/policies/scoping";
export {
  SCHOOL_SCOPED_ROLES,
  assertSchoolsInScope,
  isSchoolScopedRole,
  peopleAtSchools,
  schoolScope,
  sessionAtSchools,
  sessionInSchoolScope,
} from "@/lib/policies/schoolScope";
export {
  ACTIONS_BY_STATUS,
  ALLOW,
  type Decision,
  type SessionLike,
  availableActions,
  canBookInPast,
  canCancel,
  canChangeStatus,
  canCorrectActualTimes,
  canDecideRequest,
  canDelete,
  canEdit,
  canEditSeries,
  canMarkAttendance,
  canOverrideConflicts,
  canReschedule,
  canStartMeeting,
  canView,
  deny,
  participantRoleFor,
  requireDecision,
  statusAllows,
} from "@/lib/policies/sessions";

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
  canView,
  deny,
  participantRoleFor,
  requireDecision,
  statusAllows,
} from "@/lib/policies/sessions";

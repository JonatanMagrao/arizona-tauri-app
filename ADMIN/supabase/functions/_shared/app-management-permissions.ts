import type { MasterActor, MemberActor } from "./actors.ts";
import type { AuthUser } from "./supabase.ts";
import {
  authMethodAt,
  latestSignInAt,
  type AuthAssuranceClaims,
} from "./auth-assurance.ts";

// Explicit grant approved for this existing app identity. Pin the Auth user,
// membership and organization as well as the server-verified email, so an
// email match or a recreated account cannot inherit the permission.
const APP_MANAGEMENT_GRANT = {
  authUserId: "eb8001bd-5816-45d7-9918-93616d9a6ded",
  memberId: "ed370d64-ea34-4ebe-9a44-535b543b8824",
  organizationId: "1b1f3d14-3cea-430f-ba31-d26dbe09af02",
  email: "jonatan.silva.ext@arizona.global",
} as const;

// Used only by the app's management endpoints after getAuthUser and
// resolveMember. The actor remains an organization member; Google OAuth and
// all standalone master endpoints keep their existing assurance requirements.
export function canManageManagersFromApp(
  user: Pick<AuthUser, "id" | "email">,
  actor: MasterActor | MemberActor,
  claims: AuthAssuranceClaims,
): boolean {
  return actor.kind === "member"
    && actor.role === "admin"
    && actor.status === "active"
    && user.id === APP_MANAGEMENT_GRANT.authUserId
    && user.email === APP_MANAGEMENT_GRANT.email
    && actor.id === APP_MANAGEMENT_GRANT.memberId
    && actor.organizationId === APP_MANAGEMENT_GRANT.organizationId
    && actor.email === APP_MANAGEMENT_GRANT.email
    && authMethodAt(claims, "oauth") === null
    && latestSignInAt(claims) !== null;
}

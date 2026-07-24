import type { AuthUser } from "./supabase.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.8";

export type MasterActor = {
  kind: "master";
  id: string;
  email: string;
};

export type MemberActor = {
  kind: "member";
  id: string;
  organizationId: string;
  email: string;
  role: "admin" | "user";
};

export async function resolveMaster(admin: SupabaseClient, user: AuthUser): Promise<MasterActor | null> {
  const { data, error } = await admin
    .schema("licensing")
    .from("master_accounts")
    .select("id,email,auth_user_id,status")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.status !== "active") return null;

  return {
    kind: "master",
    id: data.id,
    email: data.email,
  };
}

export async function resolveMember(
  admin: SupabaseClient,
  user: AuthUser,
  organizationId?: string,
): Promise<MemberActor | null> {
  const select = "id,organization_id,email,auth_user_id,role,status";

  let query = admin
    .schema("licensing")
    .from("members")
    .select(select)
    .eq("auth_user_id", user.id)
    .in("status", ["invited", "active"]);

  if (organizationId) query = query.eq("organization_id", organizationId);

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;

  if (!data) return null;

  const patch: Record<string, string> = {
    last_seen_at: new Date().toISOString(),
  };

  if (Object.keys(patch).length > 0) {
    const { error: updateError } = await admin
      .schema("licensing")
      .from("members")
      .update(patch)
      .eq("id", data.id);
    if (updateError) throw updateError;
  }

  return {
    kind: "member",
    id: data.id,
    organizationId: data.organization_id,
    email: data.email,
    role: data.role,
  };
}

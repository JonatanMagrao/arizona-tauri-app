import { createClient } from "npm:@supabase/supabase-js@2";

type KeyMap = Record<string, string>;

export type AuthUser = {
  id: string;
  email: string;
};

export function getSupabaseUrl(): string {
  const value = Deno.env.get("SUPABASE_URL");
  if (!value) throw new Error("missing_supabase_url");
  return value;
}

function readKeyMap(envName: string): KeyMap {
  const raw = Deno.env.get(envName);
  if (!raw) throw new Error(`missing_${envName.toLowerCase()}`);
  const parsed = JSON.parse(raw) as KeyMap;
  if (!parsed.default) throw new Error(`missing_${envName.toLowerCase()}_default`);
  return parsed;
}

export function getPublishableKey(): string {
  return readKeyMap("SUPABASE_PUBLISHABLE_KEYS").default;
}

export function getSecretKey(): string {
  return readKeyMap("SUPABASE_SECRET_KEYS").default;
}

export function createAdminClient() {
  return createClient(getSupabaseUrl(), getSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createUserClient(accessToken: string) {
  return createClient(getSupabaseUrl(), getPublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export function requirePublishableKey(req: Request): void {
  const received = req.headers.get("apikey") || req.headers.get("x-api-key") || "";
  if (!received || received !== getPublishableKey()) {
    throw new Error("invalid_publishable_key");
  }
}

export function bearerToken(req: Request): string {
  const authorization = req.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new Error("missing_bearer_token");
  return match[1].trim();
}

export async function getAuthUser(req: Request): Promise<AuthUser> {
  const token = bearerToken(req);
  const supabase = createUserClient(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.id || !data.user.email) {
    throw new Error("invalid_user_token");
  }

  return {
    id: data.user.id,
    email: data.user.email.toLowerCase(),
  };
}

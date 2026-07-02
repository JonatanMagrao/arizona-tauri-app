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

function readRawEnv(names: string[]): { name: string; value: string } {
  for (const name of names) {
    const value = Deno.env.get(name)?.trim();
    if (value) return { name, value };
  }
  throw new Error(`missing_${names[0].toLowerCase()}`);
}

function normalizeKeyValue(name: string, value: string): string {
  if (!value.startsWith("{") && !value.startsWith("[") && !value.startsWith("\"")) {
    return value;
  }

  const parsed = JSON.parse(value) as KeyMap | string[] | string;
  if (typeof parsed === "string") return parsed;
  if (Array.isArray(parsed)) {
    const first = parsed.find((item) => typeof item === "string" && item.trim());
    if (first) return first;
  } else {
    if (typeof parsed.default === "string" && parsed.default.trim()) return parsed.default;
    const first = Object.values(parsed).find((item) => typeof item === "string" && item.trim());
    if (first) return first;
  }

  throw new Error(`missing_${name.toLowerCase()}_value`);
}

function readKey(names: string[]): string {
  const { name, value } = readRawEnv(names);
  return normalizeKeyValue(name, value);
}

export function getPublishableKey(): string {
  return readKey(["SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_PUBLISHABLE_KEY"]);
}

export function getSecretKey(): string {
  return readKey(["SUPABASE_SECRET_KEYS", "SUPABASE_SECRET_KEY"]);
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

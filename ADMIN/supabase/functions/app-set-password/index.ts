import {
  errorResponse,
  handleOptions,
  requirePost,
} from "../_shared/http.ts";
import { requirePublishableKey } from "../_shared/supabase.ts";

// Kept as an explicit tombstone so old clients cannot recreate or reset Auth
// passwords through the former unauthenticated first-access endpoint.
Deno.serve((req) => {
  const options = handleOptions(req);
  if (options) return options;

  const methodError = requirePost(req);
  if (methodError) return methodError;

  try {
    requirePublishableKey(req);
  } catch {
    return errorResponse("invalid_publishable_key", "Invalid publishable key.", 401);
  }

  return errorResponse(
    "endpoint_retired",
    "Update Arizona App to use activation codes.",
    410,
  );
});

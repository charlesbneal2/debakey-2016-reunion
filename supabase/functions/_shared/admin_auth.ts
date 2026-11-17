import { createClient } from "npm:@supabase/supabase-js@2";

/** Resolves true when the Supabase Auth access token belongs to an email in ADMIN_EMAILS. */
export type IsAdmin = (accessToken: string) => Promise<boolean>;

// Emails live in a secret, not the repo, because the repo is public.
export function adminEmails(): string[] {
  return (Deno.env.get("ADMIN_EMAILS") ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function liveIsAdmin(): IsAdmin {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const admins = adminEmails();
  return async (accessToken) => {
    if (!accessToken) return false;
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error) {
      // A bad or expired token is a 4xx; anything else is an outage, not a sign-out.
      if (error.status && error.status >= 400 && error.status < 500) return false;
      throw error;
    }
    return admins.includes(data.user.email?.toLowerCase() ?? "");
  };
}

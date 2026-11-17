import { createClient } from "npm:@supabase/supabase-js@2";
import { adminEmails } from "../_shared/admin_auth.ts";
import { sendEmail } from "../_shared/email.ts";
import { handleInviteAdmin, type LinkType } from "./handler.ts";

const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

async function makeLink(email: string) {
  // Invite fails once the account exists, so fall back to a password-reset link.
  let firstError;
  for (const type of ["invite", "recovery"] as LinkType[]) {
    const { data, error } = await supabase.auth.admin.generateLink({ type, email });
    if (!error) return { tokenHash: data.properties.hashed_token, type };
    firstError ??= error;
  }
  throw firstError;
}

const deps = { serviceKey, admins: adminEmails(), siteUrl: Deno.env.get("SITE_URL")!, makeLink, sendEmail };

Deno.serve((req) => handleInviteAdmin(req, deps));

import { json } from "../_shared/http.ts";
import type { Email } from "../_shared/email.ts";

export type LinkType = "invite" | "recovery";

export type InviteDeps = {
  serviceKey: string;
  admins: string[];
  siteUrl: string;
  /** Invite link for a new user, password-reset link for an existing one. */
  makeLink(email: string): Promise<{ tokenHash: string; type: LinkType }>;
  sendEmail(to: string, email: Email): Promise<void>;
};

async function sameSecret(given: string, expected: string): Promise<boolean> {
  const digest = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  return a.reduce((diff, byte, i) => diff | (byte ^ b[i]), 0) === 0;
}

export function inviteEmail(link: string, type: LinkType, siteUrl: string): Email {
  const intro = type === "invite"
    ? "You're set up as an organizer for the DeBakey Class of 2016 reunion."
    : "Here's a link to reset your DeBakey reunion organizer password.";
  return {
    subject: type === "invite" ? "Set your reunion organizer password" : "Reset your reunion organizer password",
    html: `<p>${intro}</p>
<p><a href="${link}">Set your password</a></p>
<p>The link works once and expires in 24 hours.</p>
<p>After that, sign in at <a href="${siteUrl}/admin.html">${siteUrl}/admin.html</a> to see who has bought tickets,
and use <a href="${siteUrl}/door.html">${siteUrl}/door.html</a> for check-in on event night.</p>`,
  };
}

// Called by hand with the service role key: curl -H "authorization: Bearer $KEY" -d '{"email":"..."}'
export async function handleInviteAdmin(req: Request, deps: InviteDeps): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const auth = req.headers.get("authorization") ?? "";
  if (!(await sameSecret(auth, `Bearer ${deps.serviceKey}`))) return json({ error: "Unauthorized." }, 401);

  let email = "";
  try {
    const body = await req.json();
    email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  } catch {
    // Falls through to the check below.
  }
  if (!deps.admins.includes(email)) return json({ error: "Email is not in ADMIN_EMAILS." }, 400);

  try {
    const { tokenHash, type } = await deps.makeLink(email);
    const link = `${deps.siteUrl}/admin.html?type=${type}&token_hash=${encodeURIComponent(tokenHash)}`;
    await deps.sendEmail(email, inviteEmail(link, type, deps.siteUrl));
    return json({ sent: email, type }, 200);
  } catch (error) {
    console.error("Invite failed", error);
    return json({ error: "Invite failed." }, 500);
  }
}

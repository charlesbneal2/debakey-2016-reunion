import { assertEquals } from "@std/assert";
import type { Email } from "../functions/_shared/email.ts";
import { handleInviteAdmin, type LinkType } from "../functions/invite-admin/handler.ts";

const SITE = "https://debakey2016reunion.com";

function setup(linkType: LinkType = "invite") {
  const sent: { to: string; email: Email }[] = [];
  const deps = {
    serviceKey: "service-key",
    admins: ["organizer@example.com"],
    siteUrl: SITE,
    makeLink: () => Promise.resolve({ tokenHash: "hash+/=", type: linkType }),
    sendEmail: (to: string, email: Email) => (sent.push({ to, email }), Promise.resolve()),
  };
  const call = (body: unknown, key = "service-key") =>
    handleInviteAdmin(
      new Request("https://fn.test/invite-admin", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      }),
      deps,
    );
  return { sent, call };
}

Deno.test("emails an admin a set-password link to admin.html", async () => {
  const { sent, call } = setup();
  const res = await call({ email: " Organizer@Example.com " });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { sent: "organizer@example.com", type: "invite" });
  assertEquals(sent.length, 1);
  assertEquals(sent[0].to, "organizer@example.com");
  assertEquals(sent[0].email.html.includes(`${SITE}/admin.html?type=invite&amp;token_hash=`), false);
  assertEquals(sent[0].email.html.includes(`${SITE}/admin.html?type=invite&token_hash=hash%2B%2F%3D`), true);
});

Deno.test("existing account gets a reset link", async () => {
  const { sent, call } = setup("recovery");
  assertEquals((await (await call({ email: "organizer@example.com" })).json()).type, "recovery");
  assertEquals(sent[0].email.subject, "Reset your reunion organizer password");
});

Deno.test("rejects wrong key and emails outside ADMIN_EMAILS without sending", async () => {
  const { sent, call } = setup();
  assertEquals((await call({ email: "organizer@example.com" }, "anon-key")).status, 401);
  assertEquals((await call({ email: "stranger@example.com" })).status, 400);
  assertEquals((await call("nope")).status, 400);
  assertEquals(sent.length, 0);
});

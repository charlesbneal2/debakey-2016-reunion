export type Email = {
  subject: string;
  html: string;
  attachments?: { filename: string; content: string; content_id: string }[];
};

export async function sendEmail(to: string, email: Email) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: "DeBakey Reunion <tickets@debakey2016reunion.com>",
      to,
      reply_to: Deno.env.get("REPLY_TO_EMAIL"),
      ...email,
    }),
  });
  if (!response.ok) throw new Error(`Resend returned ${response.status}: ${await response.text()}`);
}

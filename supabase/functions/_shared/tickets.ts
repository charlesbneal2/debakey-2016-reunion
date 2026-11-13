import QRCode from "npm:qrcode@1";
import type { StoredOrder } from "./store.ts";

export type TicketEmail = {
  subject: string;
  html: string;
  attachments: { filename: string; content: string; content_id: string }[];
};

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function ticketUrl(siteUrl: string, token: string): string {
  return `${siteUrl}/ticket?t=${token}`;
}

export async function qrPngBase64(text: string): Promise<string> {
  const buffer = await QRCode.toBuffer(text, { width: 320, margin: 2 });
  return buffer.toString("base64");
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function ticketLabel(
  t: { holder_name: string | null; kind: string; buyer_name: string },
): string {
  return t.holder_name ?? `Guest of ${t.buyer_name}`;
}

export async function buildTicketEmail(order: StoredOrder, siteUrl: string): Promise<TicketEmail> {
  const attachments: TicketEmail["attachments"] = [];
  const blocks: string[] = [];

  for (const [i, ticket] of order.tickets.entries()) {
    const url = ticketUrl(siteUrl, ticket.token);
    const label = escapeHtml(ticketLabel({ ...ticket, buyer_name: order.buyer_name }));
    const cid = `ticket-${i + 1}`;
    attachments.push({
      filename: `ticket-${i + 1}.png`,
      content: await qrPngBase64(url),
      content_id: cid,
    });
    blocks.push(`
      <div style="border:1px solid #e4e4e7;border-radius:12px;padding:20px;margin:16px 0;text-align:center">
        <div style="font-size:18px;font-weight:600;letter-spacing:-0.01em;color:#09090b">${label}</div>
        <img src="cid:${cid}" width="240" height="240" alt="Ticket QR code for ${label}" style="margin:12px auto;display:block;border:1px solid #e4e4e7;border-radius:10px">
        <a href="${url}" style="color:#12266b;font-size:14px;font-weight:500">Open or forward this ticket</a>
      </div>`);
  }

  const html = `
    <div style="font-family:Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:auto;color:#09090b;font-size:15px;line-height:1.6">
      <div style="background:#a2bffe;color:#0b1846;padding:28px 24px;text-align:center;border-radius:12px">
        <img src="https://debakey2016reunion.com/assets/logo-email.png" width="88" height="84" alt="DeBakey High School for Health Professions logo" style="display:block;margin:0 auto 12px;border:0">
        <div style="font-size:13px;font-weight:500;color:#12266b">Class of 2016 &middot; Ten Years</div>
        <h1 style="margin:8px 0 0;font-size:28px;font-weight:600;letter-spacing:-0.03em">The Ten-Year Reunion</h1>
      </div>
      <p>You're in, ${escapeHtml(order.buyer_name)}! Show ${order.tickets.length > 1 ? "these QR codes" : "this QR code"} at the door.</p>
      <p style="background:#fafafa;border:1px solid #e4e4e7;border-radius:10px;padding:12px 14px"><strong style="font-weight:600">Saturday, November 28, 2026 &middot; 6&ndash;9 PM</strong><br>Eureka Heights Brewery &middot; 941 W 18th St, Houston, TX 77008</p>
      ${blocks.join("")}
      <p style="color:#71717a;font-size:14px">Questions? Email <a href="mailto:info@debakey2016reunion.com">info@debakey2016reunion.com</a>.</p>
    </div>`;

  return { subject: "Your DeBakey reunion tickets", html, attachments };
}

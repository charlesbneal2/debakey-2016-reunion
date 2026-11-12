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
      <div style="border:1px solid #c9d4ff;padding:20px;margin:16px 0;text-align:center">
        <div style="font-size:18px;font-weight:bold;color:#12266b">${label}</div>
        <img src="cid:${cid}" width="240" height="240" alt="Ticket QR code for ${label}" style="margin:12px auto;display:block">
        <a href="${url}" style="color:#12266b">Open or forward this ticket</a>
      </div>`);
  }

  const html = `
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:520px;margin:auto;color:#1b2340">
      <div style="background:#12266b;color:#fff;padding:24px;text-align:center">
        <div style="font-size:12px;letter-spacing:2px;color:#c9d4ff">CLASS OF 2016 &middot; TEN YEARS</div>
        <h1 style="margin:8px 0 0;font-size:26px;font-weight:normal">The Ten-Year Reunion</h1>
      </div>
      <p>You're in, ${escapeHtml(order.buyer_name)}! Show ${order.tickets.length > 1 ? "these QR codes" : "this QR code"} at the door.</p>
      <p><strong>Saturday, November 28, 2026 &middot; 6&ndash;9 PM</strong><br>Eureka Heights Brewery &middot; 941 W 18th St, Houston, TX 77008</p>
      ${blocks.join("")}
      <p>Questions? Call Charles Neal at 281-966-5720.</p>
    </div>`;

  return { subject: "Your DeBakey reunion tickets", html, attachments };
}

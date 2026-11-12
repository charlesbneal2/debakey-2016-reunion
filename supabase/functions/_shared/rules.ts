export const SALES_CLOSE = new Date("2026-11-29T03:00:00Z"); // 9 PM Central, November 28
const MAX_NAME_LENGTH = 80;

export type OrderForm = {
  name: string;
  guestName: string;
  withGuest: boolean;
  showOnList: boolean;
};

export function parseOrderForm(
  body: unknown,
): { ok: true; value: OrderForm } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Please fill out the form." };
  }
  const input = body as Record<string, unknown>;
  const withGuest = input.with_guest === true;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const guestName = withGuest && typeof input.guest_name === "string" ? input.guest_name.trim() : "";

  if (!name) return { ok: false, error: "Please enter your name." };
  if (name.length > MAX_NAME_LENGTH || guestName.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Names must be ${MAX_NAME_LENGTH} characters or fewer.` };
  }
  return { ok: true, value: { name, guestName, withGuest, showOnList: input.show_on_list === true } };
}

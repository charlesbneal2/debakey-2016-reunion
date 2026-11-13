export type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

export type OrderTicket = { token: string; holder_name: string | null; kind: "classmate" | "guest" };

export type StoredOrder = {
  id: string;
  email: string;
  status: "paid" | "refunded";
  email_sent_at: string | null;
  buyer_name: string;
  tickets: OrderTicket[];
};

export type PaidOrderInput = {
  sessionId: string;
  paymentIntent: string | null;
  buyerName: string;
  email: string;
  guestName: string;
  withGuest: boolean;
  showOnList: boolean;
  amountTotal: number;
  classmateToken: string;
  guestToken: string | null;
};

export type GuestListEntry = { name: string; plus_one: boolean };

export type TicketInfo = {
  holder_name: string | null;
  buyer_name: string;
  kind: "classmate" | "guest";
  voided: boolean;
};

export type CheckInResult = {
  result: "ok" | "already" | "voided" | "not_found";
  holder_name?: string | null;
  buyer_name?: string;
  kind?: "classmate" | "guest";
  checked_in_at?: string | null;
};

export type TicketMatch = {
  token: string;
  holder_name: string | null;
  buyer_name: string;
  kind: "classmate" | "guest";
  voided: boolean;
  checked_in_at: string | null;
};

export type Signature = { name: string; message: string; created_at: string };

export type Store = ReturnType<typeof createStore>;

export function createStore(rpc: Rpc) {
  return {
    recordPaidOrder: (input: PaidOrderInput) =>
      rpc("record_paid_order", {
        p_session_id: input.sessionId,
        p_payment_intent: input.paymentIntent,
        p_buyer_name: input.buyerName,
        p_email: input.email,
        p_guest_name: input.guestName,
        p_with_guest: input.withGuest,
        p_show_on_list: input.showOnList,
        p_amount_total: input.amountTotal,
        p_classmate_token: input.classmateToken,
        p_guest_token: input.guestToken,
      }) as Promise<StoredOrder>,
    markOrderEmailed: (orderId: string) =>
      rpc("mark_order_emailed", { p_order_id: orderId }) as Promise<boolean>,
    markOrderRefunded: (paymentIntent: string) =>
      rpc("mark_order_refunded", { p_payment_intent: paymentIntent }) as Promise<boolean>,
    publicGuestList: () => rpc("public_guest_list") as Promise<GuestListEntry[]>,
    getTicket: (token: string) => rpc("get_ticket", { p_token: token }) as Promise<TicketInfo | null>,
    checkInTicket: (token: string) => rpc("check_in_ticket", { p_token: token }) as Promise<CheckInResult>,
    searchTickets: (query: string) => rpc("search_tickets", { p_query: query }) as Promise<TicketMatch[]>,
    doorAuthAllowed: (ip: string) => rpc("door_auth_allowed", { p_ip: ip }) as Promise<boolean>,
    doorAuthFailed: (ip: string) => rpc("door_auth_failed", { p_ip: ip }) as Promise<boolean>,
    listSignatures: () => rpc("list_signatures") as Promise<Signature[]>,
    /** Resolves null when this ip hash is rate limited. */
    addSignature: (name: string, message: string, ipHash: string) =>
      rpc("add_signature", { p_name: name, p_message: message, p_ip_hash: ipHash }) as Promise<Signature | null>,
  };
}

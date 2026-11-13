import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = new URL("../migrations/", import.meta.url);

export type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

export async function newDb(): Promise<{ db: PGlite; rpc: Rpc }> {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  const files = [...Deno.readDirSync(MIGRATIONS)].map((f) => f.name).filter((n) => n.endsWith(".sql")).sort();
  for (const file of files) await db.exec(await Deno.readTextFile(new URL(file, MIGRATIONS)));

  const rpc: Rpc = async (fn, args = {}) => {
    const names = Object.keys(args);
    const params = names.map((name, i) => `${name} => $${i + 1}`).join(", ");
    const { rows } = await db.query<{ result: unknown }>(
      `select ${fn}(${params}) as result`,
      Object.values(args),
    );
    return rows[0].result;
  };
  return { db, rpc };
}

let session = 0;

export function orderArgs(overrides: Record<string, unknown> = {}) {
  session++;
  return {
    p_session_id: `cs_${session}`,
    p_payment_intent: `pi_${session}`,
    p_buyer_name: "Jane Doe",
    p_email: "jane@example.com",
    p_guest_name: null,
    p_with_guest: false,
    p_show_on_list: true,
    p_amount_total: 2000,
    p_classmate_token: `classmate-${session}`,
    p_guest_token: null,
    ...overrides,
  };
}

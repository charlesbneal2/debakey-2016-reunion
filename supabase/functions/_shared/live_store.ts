import { createClient } from "npm:@supabase/supabase-js@2";
import { createStore } from "./store.ts";

export function liveStore() {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  return createStore(async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw error;
    return data;
  });
}

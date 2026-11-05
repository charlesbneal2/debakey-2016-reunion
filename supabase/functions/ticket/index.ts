import { liveStore } from "../_shared/live_store.ts";
import { handleTicket } from "./handler.ts";

const deps = { store: liveStore(), siteUrl: Deno.env.get("SITE_URL")! };

Deno.serve((req) => handleTicket(req, deps));

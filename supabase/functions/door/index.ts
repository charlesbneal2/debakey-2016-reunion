import { liveIsAdmin } from "../_shared/admin_auth.ts";
import { liveStore } from "../_shared/live_store.ts";
import { handleDoor } from "./handler.ts";

const deps = {
  store: liveStore(),
  siteUrl: Deno.env.get("SITE_URL")!,
  isAdmin: liveIsAdmin(),
};

Deno.serve((req) => handleDoor(req, deps));

import { liveStore } from "../_shared/live_store.ts";
import { handleDoor } from "./handler.ts";

const deps = {
  store: liveStore(),
  siteUrl: Deno.env.get("SITE_URL")!,
  doorPassword: Deno.env.get("DOOR_PASSWORD")!,
};

Deno.serve((req) => handleDoor(req, deps));

// Loaded with --import so server code using the app's "@/..." paths can run
// under plain node in scripts/test-assistant-db.ts.
import { register } from "node:module";

register("./alias-hooks.mjs", import.meta.url);

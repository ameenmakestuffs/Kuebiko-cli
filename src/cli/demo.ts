import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function seedDemo(sandbox: string): { ok: boolean; message: string } {
  const seed = join(sandbox, ".seed", "cart.js");
  const target = join(sandbox, "src", "cart.js");
  if (!existsSync(seed)) {
    return { ok: false, message: `Demo seed not found at ${seed}` };
  }
  try {
    copyFileSync(seed, target);
    return { ok: true, message: "demo bug restored in demo-sandbox/src/cart.js" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export const PRIMARY_MODEL = "gemini-3.8-flash";
export const LITE_MODEL = "gemini-3.5-flash-lite";

export const DEFAULT_MODEL_LADDER = [PRIMARY_MODEL, LITE_MODEL] as const;

export function buildModelLadder(primary?: string): string[] {
  const first = primary?.trim() || PRIMARY_MODEL;
  return [...new Set([first, ...DEFAULT_MODEL_LADDER])];
}

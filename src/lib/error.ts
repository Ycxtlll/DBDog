export function parseTauriError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.code === "string" && typeof obj.message === "string") {
      return `${obj.code}: ${obj.message}`;
    }
    if (typeof obj.message === "string") return obj.message;
    try {
      return JSON.stringify(obj);
    } catch {
      return "[unknown error object]";
    }
  }
  return String(err);
}

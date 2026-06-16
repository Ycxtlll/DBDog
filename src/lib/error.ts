import type { TFunction } from "i18next";

/** Extract a user-facing string from a Tauri-invoked error. */
export function parseTauriError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.code === "string" && typeof obj.message === "string") {
      return obj.message || obj.code;
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

/** Extract the AppError code (e.g. "PasswordRequired") from a Tauri error. */
export function parseTauriErrorCode(err: unknown): string | null {
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.code === "string") return obj.code;
  }
  return null;
}

/**
 * Map known AppError codes to i18n keys.
 * Falls back to parseTauriError for unknown codes.
 */
export function translateTauriError(
  err: unknown,
  t: TFunction<"connections">,
): string {
  const code = parseTauriErrorCode(err);

  // Map error codes to i18n keys (namespace is implied by the t function passed in).
  const codeKeyMap: Record<string, string> = {
    PasswordRequired: "passwordRequired",
  };

  if (code && codeKeyMap[code]) {
    const translated = t(codeKeyMap[code]);
    // i18next returns the key itself if translation is missing
    if (translated !== codeKeyMap[code]) return translated;
  }

  return parseTauriError(err);
}

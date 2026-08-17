import { confirm } from "@tauri-apps/plugin-dialog";

/**
 * Native confirm dialog. `window.confirm` is not reliably implemented in
 * Tauri/wry webviews (can silently return false or no-op), which would
 * either block or silently skip destructive operations.
 */
export async function confirmDialog(
  message: string,
  title?: string,
): Promise<boolean> {
  try {
    return await confirm(message, { title, kind: "warning" });
  } catch {
    // Plugin unavailable (e.g. dev browser) — fall back to the web dialog.
    return window.confirm(message);
  }
}

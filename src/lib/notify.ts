// System notification for "the user is needed" moments. Shown only when the app's window is hidden
// or doesn't have focus, so it never pings someone who's already looking at the chat.
// Desktop (Tauri) uses the notification plugin; a plain browser (e.g. the phone view) uses the Notification API.
import { isTauri } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

const inBackground = () => typeof document !== "undefined" && (document.hidden || !document.hasFocus());

export async function notifyUser(title: string, body: string): Promise<void> {
  if (!inBackground()) return;
  try {
    if (isTauri()) {
      let ok = await isPermissionGranted();
      if (!ok) ok = (await requestPermission()) === "granted";
      if (ok) sendNotification({ title, body });
      return;
    }
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") await Notification.requestPermission();
    if (Notification.permission === "granted") new Notification(title, { body });
  } catch {
    // no notification support here: the chat card still shows the request
  }
}

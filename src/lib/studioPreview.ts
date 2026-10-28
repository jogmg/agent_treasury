/**
 * Arc Studio preview mode.
 *
 * Arc Studio runs the app in a sandboxed preview where the Hermes BFF is not
 * available. The production app is chat-first, so opening the Studio preview
 * would otherwise mount the chat tab and fail every `/api` request. In preview
 * we default to Overview, hide Chat, and point reviewers at the live app for
 * authenticated chat and wallet transactions.
 *
 * Detection is intentionally conservative. Set `VITE_STUDIO_PREVIEW=1` or add
 * `?studioPreview=1` if the Studio preview is served from a different host.
 */

export const LIVE_APP_URL =
  "https://8080-agqvtg5gwokf3k7e5easq4hd5e.instabox.tech";

export interface StudioPreviewContext {
  hostname?: string;
  search?: string;
  referrer?: string;
  framed?: boolean;
  envFlag?: string;
}

const TRUE_FLAGS = new Set(["1", "true", "yes", "on"]);

export function isStudioPreviewContext(
  context: StudioPreviewContext = {}
): boolean {
  const envFlag = (context.envFlag ?? "").trim().toLowerCase();
  if (TRUE_FLAGS.has(envFlag)) return true;

  const search = context.search ?? "";
  if (new URLSearchParams(search).get("studioPreview") === "1") return true;

  const hostname = (context.hostname ?? "").trim().toLowerCase();
  if (hostname === "studio.arc.io" || hostname.endsWith(".studio.arc.io")) {
    return true;
  }

  // Some Studio previews run in an iframe. The referrer check is only used
  // when we are actually framed, so a production page cannot opt in merely by
  // linking from Studio.
  const referrer = (context.referrer ?? "").trim().toLowerCase();
  return context.framed === true && referrer.includes("studio.arc.io");
}

export function isStudioPreview(): boolean {
  if (typeof window === "undefined") {
    return isStudioPreviewContext({
      envFlag: import.meta.env.VITE_STUDIO_PREVIEW as string | undefined,
    });
  }

  const location = window.location;
  return isStudioPreviewContext({
    hostname: location.hostname,
    search: location.search,
    referrer: typeof document !== "undefined" ? document.referrer : "",
    framed: window.self !== window.top,
    envFlag: import.meta.env.VITE_STUDIO_PREVIEW as string | undefined,
  });
}

/** Evaluated once per page load; URL/hostname do not change during the session. */
export const STUDIO_PREVIEW = isStudioPreview();

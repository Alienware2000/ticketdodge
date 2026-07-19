/**
 * Loads the Google Maps JS API once, async, and resolves with the `google`
 * namespace. Rejects with "missing-key" | "auth" | "network" so the map can
 * show a helpful state instead of Google's gray error box.
 */

declare global {
  interface Window {
    google?: typeof google;
    gm_authFailure?: () => void;
    __gmapsReady?: () => void;
  }
}

export const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
export const MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "";

let loadPromise: Promise<typeof google> | null = null;

export function loadGoogleMaps(): Promise<typeof google> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<typeof google>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("ssr"));
      return;
    }
    if (window.google?.maps?.Map) {
      resolve(window.google);
      return;
    }
    if (!MAPS_API_KEY) {
      reject(new Error("missing-key"));
      return;
    }

    // Google calls this on an invalid/misconfigured key after the script loads.
    window.gm_authFailure = () => reject(new Error("auth"));
    window.__gmapsReady = () => resolve(window.google!);

    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: MAPS_API_KEY,
      v: "weekly",
      loading: "async",
      callback: "__gmapsReady",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => reject(new Error("network"));
    document.head.appendChild(script);
  });

  return loadPromise;
}

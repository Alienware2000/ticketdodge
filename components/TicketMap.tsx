"use client";

import { useEffect, useRef, useState } from "react";
import { MAPS_MAP_ID, loadGoogleMaps } from "@/lib/googleMaps";
import { STATUS_TONES, type LatLng, type Segment, type StatusTone } from "@/lib/segments";

type TicketMapProps = {
  segments: Segment[];
  toneById: Record<string, StatusTone>;
  selectedId: string | null;
  userLocation: LatLng | null;
  accuracy: number | null;
  focus: LatLng | null;
  onSelectSegment: (id: string) => void;
  onRoughTap: (location: LatLng) => void;
};

const FLATIRON = { lat: 40.7411, lng: -73.9897 };

// Muted, Google-native look: POI clutter off so the curb overlays stay loudest.
// Applied only when no cloud Map ID is configured (styles and mapId conflict).
const MUTED_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#f4f4f2" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#5f6368" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f4f4f2" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#e8e8e6" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#e3e3e1" }] },
  { featureType: "road.local", elementType: "labels.text.fill", stylers: [{ color: "#8a8f98" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#c8d7e3" }] },
];

type LoadState = "loading" | "ready" | "missing-key" | "auth" | "network";

export default function TicketMap({
  segments,
  toneById,
  selectedId,
  userLocation,
  accuracy,
  focus,
  onSelectSegment,
  onRoughTap,
}: TicketMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylinesRef = useRef<Map<string, google.maps.Polyline>>(new Map());
  const tonesRef = useRef<Record<string, StatusTone>>({});
  const casingRef = useRef<google.maps.Polyline | null>(null);
  const prevSelectedRef = useRef<string | null>(null);
  const userMarkerRef = useRef<google.maps.Marker | null>(null);
  const accuracyCircleRef = useRef<google.maps.Circle | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  // Latest callbacks without re-wiring listeners.
  const callbacksRef = useRef({ onSelectSegment, onRoughTap });
  callbacksRef.current = { onSelectSegment, onRoughTap };

  // Create the map + all polylines once.
  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !containerRef.current || mapRef.current) return;

        const map = new g.maps.Map(containerRef.current, {
          center: FLATIRON,
          zoom: 16,
          minZoom: 14,
          maxZoom: 20,
          disableDefaultUI: true,
          zoomControl: true,
          zoomControlOptions: { position: g.maps.ControlPosition.LEFT_BOTTOM },
          gestureHandling: "greedy",
          clickableIcons: false,
          ...(MAPS_MAP_ID ? { mapId: MAPS_MAP_ID } : { styles: MUTED_STYLE }),
        });
        mapRef.current = map;

        map.addListener("click", (event: google.maps.MapMouseEvent) => {
          if (!event.latLng) return;
          callbacksRef.current.onRoughTap({ lat: event.latLng.lat(), lng: event.latLng.lng() });
        });

        for (const segment of segments) {
          const tone = tonesRef.current[segment.id] ?? "green";
          const polyline = new g.maps.Polyline({
            map,
            path: segment.coords.map(([lat, lng]) => ({ lat, lng })),
            strokeColor: STATUS_TONES[tone].color,
            strokeOpacity: 0.9,
            strokeWeight: 5.5,
            zIndex: 10,
          });
          polyline.addListener("click", () => callbacksRef.current.onSelectSegment(segment.id));
          polylinesRef.current.set(segment.id, polyline);
        }

        casingRef.current = new g.maps.Polyline({
          map,
          path: [],
          strokeColor: "#ffffff",
          strokeOpacity: 0.95,
          strokeWeight: 13,
          zIndex: 20,
          clickable: false,
        });

        setState("ready");
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setState(
          error.message === "missing-key" || error.message === "auth" || error.message === "network"
            ? (error.message as LoadState)
            : "network",
        );
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recolor on status changes — mutate only what changed.
  useEffect(() => {
    tonesRef.current = toneById;
    if (state !== "ready") return;
    polylinesRef.current.forEach((polyline, id) => {
      const color = STATUS_TONES[toneById[id] ?? "green"].color;
      if (polyline.get("strokeColor") !== color) polyline.setOptions({ strokeColor: color });
    });
  }, [toneById, state]);

  // Selection highlight: white casing under a thicker stroke.
  useEffect(() => {
    if (state !== "ready") return;
    const previous = prevSelectedRef.current;
    if (previous && previous !== selectedId) {
      polylinesRef.current.get(previous)?.setOptions({ strokeWeight: 5.5, strokeOpacity: 0.9, zIndex: 10 });
    }
    if (selectedId) {
      const selected = polylinesRef.current.get(selectedId);
      const segment = segments.find((entry) => entry.id === selectedId);
      if (selected && segment) {
        selected.setOptions({ strokeWeight: 8, strokeOpacity: 1, zIndex: 30 });
        casingRef.current?.setPath(segment.coords.map(([lat, lng]) => ({ lat, lng })));
      }
    } else {
      casingRef.current?.setPath([]);
    }
    prevSelectedRef.current = selectedId;
  }, [selectedId, segments, state]);

  // User location dot + accuracy circle.
  useEffect(() => {
    if (state !== "ready" || !mapRef.current) return;
    const g = window.google!;
    if (!userLocation) {
      userMarkerRef.current?.setMap(null);
      accuracyCircleRef.current?.setMap(null);
      return;
    }
    if (!userMarkerRef.current) {
      userMarkerRef.current = new g.maps.Marker({
        map: mapRef.current,
        zIndex: 50,
        clickable: false,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#2563eb",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
      });
      accuracyCircleRef.current = new g.maps.Circle({
        map: mapRef.current,
        strokeColor: "#2563eb",
        strokeOpacity: 0.3,
        strokeWeight: 1,
        fillColor: "#2563eb",
        fillOpacity: 0.12,
        clickable: false,
      });
    }
    userMarkerRef.current.setMap(mapRef.current);
    userMarkerRef.current.setPosition(userLocation);
    accuracyCircleRef.current!.setMap(mapRef.current);
    accuracyCircleRef.current!.setCenter(userLocation);
    accuracyCircleRef.current!.setRadius(Math.max(accuracy ?? 0, 10));
  }, [userLocation, accuracy, state]);

  // Smooth pan to the focused point.
  useEffect(() => {
    if (state !== "ready" || !mapRef.current || !focus) return;
    const map = mapRef.current;
    map.panTo(focus);
    if ((map.getZoom() ?? 16) < 17) map.setZoom(17);
  }, [focus, state]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" aria-label="Map" />
      {state !== "ready" ? (
        <div className="absolute inset-0 grid place-items-center bg-[#f4f4f2]">
          {state === "loading" ? (
            <div className="flex items-center gap-3 rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-lg">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#ff5a3c]" />
              Loading map…
            </div>
          ) : (
            <div className="mx-4 max-w-sm rounded-2xl bg-white p-6 shadow-[0_18px_50px_rgba(16,24,40,0.18)] ring-1 ring-slate-900/5">
              <p className="text-sm font-black tracking-tight text-[#101828]">
                {state === "missing-key" ? "Add your Google Maps API key" : state === "auth" ? "Google Maps rejected the API key" : "Couldn't reach Google Maps"}
              </p>
              {state === "missing-key" ? (
                <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-[13px] leading-relaxed text-slate-600">
                  <li>
                    Create a <span className="font-semibold">Maps JavaScript API</span> key at{" "}
                    <span className="font-mono text-[12px]">console.cloud.google.com</span>
                  </li>
                  <li>
                    Paste it into <span className="font-mono text-[12px]">.env.local</span> as{" "}
                    <span className="font-mono text-[12px]">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</span>
                  </li>
                  <li>Restart the dev server</li>
                </ol>
              ) : (
                <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
                  {state === "auth"
                    ? "Check that the key is valid, has billing enabled, and allows the Maps JavaScript API."
                    : "Check your connection and reload."}
                </p>
              )}
              <p className="mt-3 text-[12px] text-slate-500">
                The panel below still works — search and curb picking don&apos;t need the map.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

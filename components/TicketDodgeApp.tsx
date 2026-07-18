"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import TicketMap from "@/components/TicketMap";
import {
  findStreet,
  getNearestViolation,
  streetNames,
} from "@/lib/data";
import { getRisk } from "@/lib/score";

const FLATIRON = { lat: 40.7411, lng: -73.9897 };

function formatHour(hour: number) {
  const normalized = hour % 24;
  const suffix = normalized >= 12 ? "pm" : "am";
  const displayHour = normalized % 12 || 12;
  return `${displayHour}${suffix}`;
}

function getRiskStyle(score: number) {
  if (score < 34) {
    return { color: "#22c55e", label: "Low risk", pill: "bg-emerald-500/15 text-emerald-300" };
  }
  if (score <= 66) {
    return { color: "#facc15", label: "Moderate risk", pill: "bg-yellow-400/15 text-yellow-200" };
  }
  return { color: "#ff5a3c", label: "High risk", pill: "bg-[#ff5a3c]/15 text-[#ff9d8b]" };
}

function getRecommendation(score: number, peakHour: number) {
  if (score > 66) {
    return `Move by ${formatHour((peakHour + 1) % 24)} — enforcement is heavy on this block.`;
  }
  if (score >= 34) {
    return "Park one block west — nearby streets trend lower.";
  }
  return "Low risk now — recheck the curb signs before leaving.";
}

export default function TicketDodgeApp() {
  const now = useMemo(() => new Date(), []);
  const currentDay = now.toLocaleDateString("en-US", { weekday: "long" });
  const currentHour = now.getHours();
  const [location, setLocation] = useState(FLATIRON);
  const [userLocation, setUserLocation] = useState<typeof FLATIRON | null>(null);
  const [query, setQuery] = useState("");
  const [searchMessage, setSearchMessage] = useState("");
  const userInteracted = useRef(false);

  useEffect(() => {
    let isActive = true;

    function fallbackToFlatiron() {
      if (!isActive || userInteracted.current) return;
      setLocation(FLATIRON);
      setSearchMessage("Location unavailable — showing Flatiron.");
    }

    if (!("geolocation" in navigator)) {
      fallbackToFlatiron();
      return () => {
        isActive = false;
      };
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!isActive) return;

        const nextLocation = {
          lat: coords.latitude,
          lng: coords.longitude,
        };
        setUserLocation(nextLocation);

        if (!userInteracted.current) {
          setLocation(nextLocation);
          setSearchMessage("Using your current location.");
        }
      },
      fallbackToFlatiron,
      {
        enableHighAccuracy: true,
        maximumAge: 300_000,
        timeout: 8_000,
      },
    );

    return () => {
      isActive = false;
    };
  }, []);

  const selected = useMemo(
    () => getNearestViolation(location.lat, location.lng, currentDay, currentHour),
    [location, currentDay, currentHour],
  );
  const score = useMemo(
    () => getRisk(location.lat, location.lng, currentDay, currentHour),
    [location, currentDay, currentHour],
  );
  const riskStyle = getRiskStyle(score);
  const recommendation = getRecommendation(score, selected.hour);

  function selectStreet(value: string, announce = true) {
    const match = findStreet(value);
    if (!match) {
      if (announce) setSearchMessage("Try Broadway, 5th Ave, E 18th St, or Park Ave S.");
      return false;
    }

    userInteracted.current = true;
    setLocation({ lat: match.lat, lng: match.lng });
    setSearchMessage(announce ? `Showing ${match.street}` : "");
    return true;
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    selectStreet(query);
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    setSearchMessage("");
    if (value.trim().length >= 3) selectStreet(value, false);
  }

  function handleMapClick(nextLocation: typeof FLATIRON) {
    userInteracted.current = true;
    setLocation(nextLocation);
    setQuery("");
    setSearchMessage("Map point selected");
  }

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#ebe8df]">
      <section className="absolute inset-0 md:right-[420px]" aria-label="Parking ticket risk map">
        <TicketMap
          location={location}
          userLocation={userLocation}
          selectedStreet={selected.street}
          scoreColor={riskStyle.color}
          onLocationSelect={handleMapClick}
        />
        <div className="map-vignette" />
      </section>

      <div className="pointer-events-none absolute left-4 top-4 z-[1000] flex items-center gap-2 md:left-6 md:top-6">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#101828] text-lg font-black text-white shadow-lg">
          P
        </div>
        <div className="rounded-xl bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
          <p className="text-[15px] font-black tracking-[-0.04em] text-[#101828]">
            ticket<span className="text-[#ff5a3c]">dodge</span>
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSearch}
        className="absolute left-1/2 top-[72px] z-[1000] w-[calc(100%-32px)] max-w-[460px] -translate-x-1/2 md:left-6 md:top-[84px] md:w-[380px] md:translate-x-0"
        role="search"
      >
        <div className="flex items-center rounded-2xl bg-white p-1.5 shadow-[0_14px_45px_rgba(16,24,40,0.18)] ring-1 ring-slate-900/5">
          <span className="pl-3 text-xl text-slate-400" aria-hidden="true">
            ⌕
          </span>
          <label htmlFor="street-search" className="sr-only">
            Search a Flatiron street
          </label>
          <input
            id="street-search"
            list="street-options"
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            placeholder="Search a street near Flatiron"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none placeholder:font-medium placeholder:text-slate-400"
          />
          <datalist id="street-options">
            {streetNames.map((street) => (
              <option key={street} value={street} />
            ))}
          </datalist>
          <button
            type="submit"
            className="rounded-xl bg-[#101828] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-[#ff5a3c] focus:ring-offset-2"
          >
            Check
          </button>
        </div>
        <p className="mt-2 min-h-5 pl-3 text-xs font-semibold text-slate-700 drop-shadow-sm" aria-live="polite">
          {searchMessage || "Tap anywhere on the map to check another curb."}
        </p>
      </form>

      <aside
        className="absolute bottom-0 right-0 z-[1200] h-[46vh] w-full overflow-y-auto rounded-t-[28px] bg-[#101828] px-5 pb-5 pt-4 text-white shadow-[0_-15px_50px_rgba(16,24,40,0.3)] md:top-0 md:h-full md:w-[420px] md:rounded-none md:px-8 md:pb-8 md:pt-7 md:shadow-[-18px_0_50px_rgba(16,24,40,0.16)]"
        aria-live="polite"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20 md:hidden" />

        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
              Current curb
            </p>
            <h1 className="mt-1 text-lg font-bold tracking-tight md:text-xl">{selected.street}</h1>
          </div>
          <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">
            {currentDay.slice(0, 3)} · {formatHour(currentHour)}
          </span>
        </header>

        <section className="mt-4 flex items-center gap-5 border-y border-white/10 py-4 md:mt-7 md:flex-col md:items-start md:gap-3 md:py-7">
          <div
            className="score-ring grid h-24 w-24 shrink-0 place-items-center rounded-full p-[5px] md:h-40 md:w-40 md:p-2"
            style={{
              "--score-color": riskStyle.color,
              "--score-value": `${score}%`,
            } as React.CSSProperties}
          >
            <div className="grid h-full w-full place-items-center rounded-full bg-[#101828]">
              <div className="text-center">
                <span className="block text-4xl font-black leading-none tracking-[-0.07em] md:text-6xl" style={{ color: riskStyle.color }}>
                  {score}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">/ 100</span>
              </div>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.17em] text-slate-400">Ticket Risk</p>
            <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-bold ${riskStyle.pill}`}>
              {riskStyle.label}
            </span>
            <p className="mt-2 max-w-[210px] text-xs leading-relaxed text-slate-400 md:text-sm">
              Based on nearby violations and the current time window.
            </p>
          </div>
        </section>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 py-4 md:gap-y-6 md:py-7">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-500">Tickets last year</dt>
            <dd className="mt-1 text-xl font-extrabold tracking-tight md:text-2xl">{selected.count.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-500">Peak window</dt>
            <dd className="mt-1 text-base font-bold md:text-lg">{selected.day.slice(0, 3)} · {formatHour(selected.hour)}</dd>
          </div>
          <div className="col-span-2 border-t border-white/10 pt-4 md:pt-5">
            <dt className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-500">Most common violation</dt>
            <dd className="mt-1 flex items-baseline justify-between gap-3 text-sm font-bold md:text-base">
              <span>{selected.topViolation}</span>
              <span className="shrink-0 text-[#ff9d8b]">${selected.avgFine} avg.</span>
            </dd>
          </div>
        </dl>

        <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 md:mt-auto md:px-5 md:py-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#ff9d8b]">Best move</p>
          <p className="mt-1 text-sm font-bold leading-snug md:text-base">{recommendation}</p>
        </div>

        <p className="mt-4 hidden text-[10px] leading-relaxed text-slate-600 md:block">
          Estimates are directional. Always follow posted curb and parking signs.
        </p>
      </aside>
    </main>
  );
}

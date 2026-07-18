"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import TicketMap from "@/components/TicketMap";
import {
  dataSource,
  findStreet,
  getNearestViolation,
  streetNames,
} from "@/lib/data";
import {
  getConfidence,
  getRisk,
  getRiskBreakdown,
} from "@/lib/score";
import {
  getCurrentParkingOption,
  getParkingOptions,
  getStopRecommendation,
  type ParkingPreferences,
} from "@/lib/planning";
import type { ParkingContext } from "@/lib/parking-context";

const FLATIRON = { lat: 40.7411, lng: -73.9897 };
/** Overnight is modeled as a 12-hour curb stay (typical evening → morning). */
const OVERNIGHT_MINUTES = 12 * 60;
const durationOptions = [30, 60, 120, 5 * 60, OVERNIGHT_MINUTES];

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

function formatDuration(durationMinutes: number) {
  if (durationMinutes === OVERNIGHT_MINUTES) return "Overnight";
  if (durationMinutes < 60) return `${durationMinutes} min`;
  if (durationMinutes === 60) return "1 hr";
  return `${durationMinutes / 60} hr`;
}

function getRecommendation(score: number, safeUntil: string, durationMinutes: number) {
  const isOvernight = durationMinutes >= OVERNIGHT_MINUTES;
  if (score > 66) {
    return isOvernight
      ? `Heavy historical enforcement—overnight here is a stretch. Recheck by ${safeUntil}.`
      : `Move by ${safeUntil} — enforcement is heavy on this block.`;
  }
  if (score >= 34) {
    return isOvernight
      ? `Recheck before morning enforcement (by ${safeUntil}), or choose the safer block below.`
      : `Recheck by ${safeUntil}, or choose the safer block below.`;
  }
  return isOvernight
    ? `Historical enforcement is relatively lower for an overnight stay through ${safeUntil}.`
    : `Risk stays relatively low through ${safeUntil}.`;
}

export default function TicketDodgeApp() {
  const now = useMemo(() => new Date(), []);
  const currentDay = now.toLocaleDateString("en-US", { weekday: "long" });
  const currentHour = now.getHours();
  const [location, setLocation] = useState(FLATIRON);
  const [userLocation, setUserLocation] = useState<typeof FLATIRON | null>(null);
  const [query, setQuery] = useState("");
  const [searchMessage, setSearchMessage] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [arrivalHour, setArrivalHour] = useState(currentHour);
  const [preferences, setPreferences] = useState<ParkingPreferences>({
    maxWalkBlocks: 4,
    maxSearchMinutes: 8,
    riskTolerance: "medium",
    isInAHurry: false,
  });
  const [parkingContext, setParkingContext] = useState<ParkingContext | null>(null);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "unavailable">("idle");
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

  useEffect(() => {
    let isActive = true;
    fetch("/api/parking-context")
      .then((response) => (response.ok ? response.json() : null))
      .then((context: ParkingContext | null) => {
        if (isActive) setParkingContext(context);
      })
      .catch(() => undefined);
    return () => { isActive = false; };
  }, []);

  const selected = useMemo(
    () => getNearestViolation(location.lat, location.lng, currentDay, arrivalHour),
    [location, currentDay, arrivalHour],
  );
  const score = useMemo(
    () => getRisk(location.lat, location.lng, currentDay, arrivalHour, durationMinutes),
    [location, currentDay, arrivalHour, durationMinutes],
  );
  const breakdown = useMemo(
    () =>
      getRiskBreakdown(
        location.lat,
        location.lng,
        currentDay,
        arrivalHour,
        durationMinutes,
      ),
    [location, currentDay, arrivalHour, durationMinutes],
  );
  const parkingOptions = useMemo(
    () => getParkingOptions(location.lat, location.lng, currentDay, arrivalHour, durationMinutes, preferences, parkingContext),
    [location, currentDay, arrivalHour, durationMinutes, preferences, parkingContext],
  );
  const currentOption = useMemo(
    () => getCurrentParkingOption(location.lat, location.lng, currentDay, arrivalHour, durationMinutes, preferences, parkingContext),
    [location, currentDay, arrivalHour, durationMinutes, preferences, parkingContext],
  );
  const stopRecommendation = useMemo(
    () => getStopRecommendation(currentOption, parkingOptions, preferences),
    [currentOption, parkingOptions, preferences],
  );
  const riskStyle = getRiskStyle(score);
  const safeMinutes =
    durationMinutes >= OVERNIGHT_MINUTES
      ? score > 66
        ? 6 * 60
        : score >= 34
          ? 9 * 60
          : durationMinutes
      : score > 66
        ? Math.min(durationMinutes, 30)
        : score >= 34
          ? Math.min(durationMinutes, Math.max(60, Math.round(durationMinutes * 0.4)))
          : durationMinutes;
  const arrivalTime = new Date(now);
  arrivalTime.setHours(arrivalHour, 0, 0, 0);
  const safeUntil = new Date(arrivalTime.getTime() + safeMinutes * 60_000).toLocaleTimeString(
    "en-US",
    { hour: "numeric", minute: "2-digit" },
  );
  const confidence = getConfidence(selected.count);
  const recommendation = getRecommendation(score, safeUntil, durationMinutes);
  const decisionSignals = [
    {
      label: "Citation pattern",
      value: `${Math.round(selected.count).toLocaleString()} records`,
      note: "Historical enforcement at this curb",
    },
    {
      label: "Stay length",
      value: formatDuration(durationMinutes),
      note: "Longer stays compound exposure",
    },
    {
      label: "Curb availability",
      value: `${currentOption.availability}% open`,
      note: "Estimated from local activity patterns",
    },
  ];
  function selectStreet(value: string, announce = true) {
    const match = findStreet(value);
    if (!match) {
      if (announce) setSearchMessage("Try a Flatiron destination like Broadway, 5th Ave, E 18th St, or Park Ave S.");
      return false;
    }

    userInteracted.current = true;
    setLocation({ lat: match.lat, lng: match.lng });
    setQuery(match.street);
    setSearchMessage(announce ? `Destination set: ${match.street}` : "");
    return true;
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    selectStreet(query);
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    setSearchMessage("");
    const exactStreet = streetNames.find(
      (street) => street.toLowerCase() === value.trim().toLowerCase(),
    );
    if (exactStreet) selectStreet(exactStreet, false);
  }

  function handleMapClick(nextLocation: typeof FLATIRON) {
    userInteracted.current = true;
    setLocation(nextLocation);
    setQuery("");
    setSearchMessage("Destination point selected");
  }

  function handleOptionSelect(street: string) {
    const alternative = parkingOptions.find((option) => option.entry.street === street);
    if (!alternative) return;
    userInteracted.current = true;
    setLocation({ lat: alternative.entry.lat, lng: alternative.entry.lng });
    setQuery(alternative.entry.street);
    setSearchMessage(`Recommended parking: ${alternative.entry.street} · ${alternative.blocksAway} block walk to your destination`);
  }

  function handleUseMyLocation() {
    if (!userLocation) return;
    userInteracted.current = true;
    setLocation(userLocation);
    setQuery("");
    setSearchMessage("Centered on your location.");
  }

  async function handleShareDecision() {
    const decision = `TicketDodge parking plan: ${selected.street} has a ${score}/100 ticket risk for a ${formatDuration(durationMinutes).toLowerCase()} stay at ${formatHour(arrivalHour)}. ${recommendation}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "TicketDodge parking plan", text: decision });
        return;
      }
      await navigator.clipboard.writeText(decision);
      setShareStatus("copied");
      window.setTimeout(() => setShareStatus("idle"), 2200);
    } catch {
      setShareStatus("unavailable");
      window.setTimeout(() => setShareStatus("idle"), 2200);
    }
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
        <div className="grid h-12 w-12 place-items-center rounded-[18px] bg-[#2c1934] text-[24px] font-black text-[#f4e8c6] shadow-[0_10px_24px_rgba(81,42,67,0.24)]">
          P
        </div>
        <div className="rounded-[18px] border border-[#f4e8c6]/70 bg-[#fff8e8]/95 px-4 py-2.5 shadow-[0_10px_24px_rgba(81,42,67,0.16)] backdrop-blur">
          <p className="text-[17px] font-black tracking-[-0.055em] text-[#2c1934]">
            ticket<span className="text-[#d65d62]">dodge</span>
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSearch}
        className="absolute left-1/2 top-[72px] z-[1000] w-[calc(100%-32px)] max-w-[460px] -translate-x-1/2 md:left-6 md:top-[84px] md:w-[390px] md:translate-x-0"
        role="search"
      >
        <div className="flex items-center rounded-2xl bg-white/95 p-1.5 shadow-[0_12px_32px_rgba(23,35,59,0.14)] ring-1 ring-slate-900/5 backdrop-blur transition focus-within:ring-2 focus-within:ring-[#ff5a3c]/60">
          <span className="relative ml-3 h-4 w-4 shrink-0" aria-hidden="true">
            <span className="absolute left-0 top-0 h-3 w-3 rounded-full border-2 border-slate-400" />
            <span className="absolute bottom-0 right-0 h-1.5 w-0.5 rotate-[-45deg] rounded-full bg-slate-400" />
          </span>
          <label htmlFor="street-search" className="sr-only">
            Where are you going?
          </label>
          <input
            id="street-search"
            list="street-options"
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            placeholder="Where are you going? Try Broadway"
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
            className="rounded-xl bg-[#101828] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-[#ff5a3c] focus:ring-offset-2"
          >
            Plan parking
          </button>
        </div>
        <div className="mt-2 flex min-h-8 items-center justify-between gap-2 pl-2">
          <p className="rounded-full bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm backdrop-blur" aria-live="polite">
            {searchMessage || "Enter your destination, then we’ll find the best place to park nearby."}
          </p>
          {userLocation ? (
            <button
              type="button"
              onClick={handleUseMyLocation}
              className="shrink-0 rounded-full bg-[#2563eb] px-3 py-1.5 text-[11px] font-bold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              ◎ My location
            </button>
          ) : null}
        </div>
      </form>

      <aside
        className="risk-panel absolute bottom-0 right-0 z-[1200] h-[54vh] w-full overscroll-contain overflow-y-auto rounded-t-[28px] border-t border-white/15 bg-[#2c1934] px-5 pb-6 pt-4 text-white shadow-[0_-15px_42px_rgba(81,42,67,0.24)] md:top-0 md:h-full md:w-[420px] md:rounded-none md:border-l md:border-t-0 md:px-8 md:pb-8 md:pt-7 md:shadow-[-18px_0_42px_rgba(81,42,67,0.18)]"
        aria-live="polite"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20 md:hidden" />

        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#ff9d8b]">
              Your destination
            </p>
            <h1 className="mt-1 text-lg font-bold tracking-tight md:text-xl">{selected.street}</h1>
            <p className="mt-1 text-xs text-slate-500">We’ll rank parking spots within your walking limit.</p>
          </div>
          <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">
            {currentDay.slice(0, 3)} · {formatHour(arrivalHour)}
          </span>
        </header>

        <fieldset className="mt-4 md:mt-5">
          <legend className="flex w-full items-center justify-between text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
            <span>How long are you parking?</span>
            <span className="normal-case tracking-normal text-slate-600">Changes your estimate</span>
          </legend>
          <div className="mt-2 grid grid-cols-3 gap-1.5 rounded-2xl bg-white/[0.06] p-1.5 sm:grid-cols-5">
            {durationOptions.map((minutes) => {
              const selectedDuration = minutes === durationMinutes;
              return (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={selectedDuration}
                  onClick={() => setDurationMinutes(minutes)}
                  className={`rounded-xl px-2 py-2 text-[11px] font-bold transition focus:outline-none focus:ring-2 focus:ring-[#ff5a3c] sm:text-xs ${
                    selectedDuration
                      ? "bg-white text-[#101828] shadow-sm"
                      : "text-slate-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {formatDuration(minutes)}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="mt-3 block text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
          When do you arrive?
          <select
            aria-label="Arrival time"
            value={arrivalHour}
            onChange={(event) => setArrivalHour(Number(event.target.value))}
            className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm font-bold normal-case tracking-normal text-white outline-none focus:ring-2 focus:ring-[#ff5a3c]"
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour} className="bg-[#101828]">{formatHour(hour)}</option>
            ))}
          </select>
        </label>

        <section className="mt-4 rounded-[24px] border border-white/10 bg-white/[0.045] p-4 shadow-inner md:mt-5 md:p-5">
          <div className="flex items-center gap-5">
          <div
            className="score-ring grid h-24 w-24 shrink-0 place-items-center rounded-full p-[5px] md:h-28 md:w-28 md:p-1.5"
            style={{
              "--score-color": riskStyle.color,
              "--score-value": `${score}%`,
            } as React.CSSProperties}
          >
            <div className="grid h-full w-full place-items-center rounded-full bg-[#101828]">
              <div className="text-center">
                <span className="block text-4xl font-black leading-none tracking-[-0.07em] md:text-[44px]" style={{ color: riskStyle.color }}>
                  {score}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">/ 100</span>
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.17em] text-slate-400">Ticket Risk</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${riskStyle.pill}`}>
                {riskStyle.label}
              </span>
              <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-slate-300">
                {confidence} confidence
              </span>
            </div>
            <p className="mt-2 max-w-[210px] text-xs leading-relaxed text-slate-400 md:text-sm">
              Relative exposure for{" "}
              {durationMinutes === OVERNIGHT_MINUTES
                ? "an overnight"
                : `a ${formatDuration(durationMinutes).toLowerCase()}`}{" "}
              stay—not a ticket probability.
            </p>
          </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-4 border-t border-white/10 pt-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Suggested move time</p>
              <p className="mt-1 text-sm font-semibold text-slate-300">Based on this parking window</p>
            </div>
            <p className="text-2xl font-black tracking-tight text-white">{safeUntil}</p>
          </div>
        </section>

        <div className="mt-3 rounded-2xl border border-[#ff5a3c]/20 bg-[#ff5a3c]/[0.07] px-4 py-3 md:px-5 md:py-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#ff9d8b]">Recommended next step</p>
          <p className="mt-1 text-sm font-bold leading-snug text-white md:text-base">{recommendation}</p>
        </div>

        <section className="mt-3 overflow-hidden rounded-2xl border border-sky-300/20 bg-gradient-to-br from-sky-400/[0.12] to-indigo-400/[0.06]" aria-label="Explainable parking decision">
          <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-sky-200">Decision receipt</p>
              <h2 className="mt-1 text-sm font-black text-white">See what shaped this call</h2>
            </div>
            <button
              type="button"
              onClick={handleShareDecision}
              className="rounded-lg border border-white/15 bg-white/10 px-2.5 py-1.5 text-[10px] font-bold text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              {shareStatus === "copied" ? "Copied" : shareStatus === "unavailable" ? "Try again" : "Share"}
            </button>
          </div>
          <div className="grid divide-y divide-white/10 border-t border-white/10 bg-[#0b1220]/35">
            {decisionSignals.map((signal) => (
              <div key={signal.label} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <div>
                  <p className="text-[11px] font-bold text-slate-200">{signal.label}</p>
                  <p className="mt-0.5 text-[9px] text-slate-400">{signal.note}</p>
                </div>
                <span className="shrink-0 text-[11px] font-black text-sky-200">{signal.value}</span>
              </div>
            ))}
          </div>
          <p className="px-4 py-2.5 text-[9px] leading-relaxed text-slate-400">Transparent estimate, not a guarantee: TicketDodge weighs historical citations, your arrival window, and expected exposure. It never claims access to a live enforcement feed.</p>
        </section>

        <section className="mt-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.07] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-300">Park or keep searching?</p>
              <p className="mt-1 text-sm font-bold leading-snug text-white">{stopRecommendation.message}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${stopRecommendation.shouldKeepSearching ? "bg-yellow-400/15 text-yellow-200" : "bg-emerald-400/15 text-emerald-300"}`}>
              {stopRecommendation.shouldKeepSearching ? "Search" : "Park"}
            </span>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-400">Optimal-stopping estimate: compares expected savings with the cost of another search loop.</p>
        </section>

        <section className="mt-3 rounded-2xl border border-white/10 bg-black/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-bold text-white">Best places to park nearby</h2>
            <span className="text-[10px] font-semibold text-slate-500">walk + meter + exposure</span>
          </div>
          <div className="mt-3 space-y-2">
            {parkingOptions.slice(0, 3).map((option, index) => (
              <button
                key={option.entry.street}
                type="button"
                onClick={() => handleOptionSelect(option.entry.street)}
                className={`w-full rounded-xl px-3 py-2.5 text-left transition focus:outline-none focus:ring-2 focus:ring-emerald-400 ${option.entry.street === selected.street ? "bg-white/10" : "bg-white/[0.04] hover:bg-white/[0.08]"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0"><span className="mr-2 text-[10px] font-black text-emerald-300">{index === 0 ? "BEST" : `#${index + 1}`}</span><span className="text-xs font-bold text-white">{option.entry.street}</span></span>
                  <span className="text-sm font-black text-emerald-300">${option.totalExpectedCost.toFixed(0)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] font-semibold text-slate-500">
                  <span>{option.blocksAway} block walk</span><span>{option.availability}% open</span><span>{option.ticketRisk}% ticket risk</span>
                </div>
              </button>
            ))}
          </div>
          <p className="mt-3 border-t border-white/10 pt-3 text-[10px] leading-relaxed text-slate-500">Current curb: {currentOption.availability}% estimated open · {currentOption.restriction}. ${currentOption.totalExpectedCost.toFixed(0)} = ${currentOption.meterCost.toFixed(0)} meter + ${currentOption.expectedTicketCost.toFixed(0)} ticket risk + ${currentOption.expectedTowCost.toFixed(0)} tow exposure + walking/search time.</p>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-600">Availability combines historical citation activity with a meter-occupancy proxy.{parkingContext ? ` Live inputs: ${parkingContext.weather.temperatureF ?? "—"}°F, ${parkingContext.traffic.medianMph ?? "—"} mph traffic, ${parkingContext.events.activeOrUpcoming} active Manhattan events${parkingContext.sources.parking === "here" ? `, and ${parkingContext.parking.nearbyFacilities} HERE parking facilities nearby.` : "."}` : " Loading live weather, traffic, event, and parking inputs…"}</p>
        </section>

        <details className="mt-3 rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-bold text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5a3c]">
            Parking preferences
            <span className="text-base text-slate-500" aria-hidden="true">⌄</span>
          </summary>
          <div className="mt-4 grid gap-3 border-t border-white/10 pt-4">
            <label className="text-[11px] font-bold text-slate-300">Maximum walk: {preferences.maxWalkBlocks} blocks
              <input aria-label="Maximum walking distance" className="mt-2 w-full accent-[#ff5a3c]" type="range" min="1" max="10" value={preferences.maxWalkBlocks} onChange={(event) => setPreferences((value) => ({ ...value, maxWalkBlocks: Number(event.target.value) }))} />
            </label>
            <label className="text-[11px] font-bold text-slate-300">Search-time limit: {preferences.maxSearchMinutes} min
              <input aria-label="Search time limit" className="mt-2 w-full accent-[#ff5a3c]" type="range" min="2" max="20" step="1" value={preferences.maxSearchMinutes} onChange={(event) => setPreferences((value) => ({ ...value, maxSearchMinutes: Number(event.target.value) }))} />
            </label>
            <div><p className="text-[11px] font-bold text-slate-300">Ticket-risk tolerance</p><div className="mt-2 grid grid-cols-3 gap-1.5">{(["low", "medium", "high"] as const).map((tolerance) => <button key={tolerance} type="button" onClick={() => setPreferences((value) => ({ ...value, riskTolerance: tolerance }))} className={`rounded-lg px-2 py-1.5 text-[10px] font-bold capitalize ${preferences.riskTolerance === tolerance ? "bg-white text-[#101828]" : "bg-white/5 text-slate-400"}`}>{tolerance}</button>)}</div></div>
            <button type="button" onClick={() => setPreferences((value) => ({ ...value, isInAHurry: !value.isInAHurry }))} aria-pressed={preferences.isInAHurry} className={`rounded-xl px-3 py-2 text-left text-[11px] font-bold ${preferences.isInAHurry ? "bg-[#ff5a3c] text-white" : "bg-white/5 text-slate-300"}`}>In a hurry {preferences.isInAHurry ? "· yes" : "· no"}</button>
          </div>
        </details>

        <section className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-white">
              Why this score
            </h2>
            <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">
              Heuristic
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {breakdown.map((factor) => (
              <div key={factor.label}>
                <div className="flex items-center justify-between gap-4 text-[11px]">
                  <span className="font-bold text-slate-300">{factor.label}</span>
                  <span className="truncate text-slate-500">{factor.detail}</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full transition-[width] duration-300"
                    style={{ width: `${factor.strength}%`, backgroundColor: riskStyle.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <details className="mt-3 rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-bold text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5a3c]">
            Historical context
            <span className="text-base text-slate-500" aria-hidden="true">⌄</span>
          </summary>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-white/10 pt-4">
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-500">FY2026 tickets</dt>
              <dd className="mt-1 text-xl font-extrabold tracking-tight">{selected.count.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-500">Peak window</dt>
              <dd className="mt-1 text-base font-bold">{selected.day.slice(0, 3)} · {formatHour(selected.hour)}</dd>
            </div>
            <div className="col-span-2 border-t border-white/10 pt-4">
              <dt className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-500">Most common violation</dt>
              <dd className="mt-1 flex items-baseline justify-between gap-3 text-sm font-bold">
                <span>{selected.topViolation}</span>
                <span className="shrink-0 text-[#ff9d8b]">${selected.avgFine} avg.</span>
              </dd>
            </div>
          </dl>
        </details>

        <p className="mx-auto mt-5 max-w-xs text-center text-[10px] leading-relaxed text-slate-500">
          Street totals from{" "}
          <a
            href={dataSource.datasetUrl}
            target="_blank"
            rel="noreferrer"
            className="font-bold text-slate-400 underline decoration-white/20 underline-offset-2 hover:text-white"
          >
            NYC Open Data FY2026
          </a>
          . Map points are representative and risk remains heuristic. Always follow posted signs.
        </p>
      </aside>
    </main>
  );
}

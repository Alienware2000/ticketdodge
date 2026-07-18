"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import TicketMap from "@/components/TicketMap";
import {
  dataSource,
  findStreet,
  getNearestViolation,
  streetNames,
  totalTickets,
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

const FLATIRON = { lat: 40.7411, lng: -73.9897 };
const durationOptions = [30, 60, 120];

type TrafficCondition = {
  available: boolean;
  source: string;
  sourceUrl: string;
  speedMph?: number;
  observedAt?: string;
  linkName?: string;
  distanceMiles?: number;
  label: string;
  searchMultiplier: number;
};

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
  if (durationMinutes < 60) return `${durationMinutes} min`;
  return `${durationMinutes / 60} hr`;
}

function getRecommendation(score: number) {
  if (score > 66) {
    return "Heavy historical enforcement—keep this stop short.";
  }
  if (score >= 34) {
    return "Recheck the curb or compare the alternatives below.";
  }
  return "Historical enforcement is relatively lower here.";
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
  const [traffic, setTraffic] = useState<TrafficCondition | null>(null);
  const [preferences, setPreferences] = useState<ParkingPreferences>({
    maxWalkBlocks: 4,
    maxSearchMinutes: 8,
    riskTolerance: "medium",
    isInAHurry: false,
  });
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
    const controller = new AbortController();

    async function loadTrafficCondition() {
      try {
        const response = await fetch(
          `/api/conditions?lat=${location.lat}&lng=${location.lng}`,
          { cache: "no-store", signal: controller.signal },
        );
        const condition = (await response.json()) as TrafficCondition;
        setTraffic(condition);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setTraffic({
          available: false,
          source: "NYC DOT Traffic Speeds",
          sourceUrl:
            "https://data.cityofnewyork.us/Transportation/DOT-Traffic-Speeds/i4gi-tjb9",
          label: "Feed unavailable",
          searchMultiplier: 1,
        });
      }
    }

    loadTrafficCondition();
    return () => controller.abort();
  }, [location.lat, location.lng]);

  const selected = useMemo(
    () => getNearestViolation(location.lat, location.lng, currentDay, currentHour),
    [location, currentDay, currentHour],
  );
  const score = useMemo(
    () => getRisk(location.lat, location.lng, currentDay, currentHour, durationMinutes),
    [location, currentDay, currentHour, durationMinutes],
  );
  const breakdown = useMemo(
    () =>
      getRiskBreakdown(
        location.lat,
        location.lng,
        currentDay,
        currentHour,
        durationMinutes,
      ),
    [location, currentDay, currentHour, durationMinutes],
  );
  const parkingOptions = useMemo(
    () =>
      getParkingOptions(
        location.lat,
        location.lng,
        currentDay,
        currentHour,
        durationMinutes,
        preferences,
        { searchMultiplier: traffic?.searchMultiplier ?? 1 },
      ),
    [location, currentDay, currentHour, durationMinutes, preferences, traffic?.searchMultiplier],
  );
  const currentOption = useMemo(
    () =>
      getCurrentParkingOption(
        location.lat,
        location.lng,
        currentDay,
        currentHour,
        durationMinutes,
        preferences,
        { searchMultiplier: traffic?.searchMultiplier ?? 1 },
      ),
    [location, currentDay, currentHour, durationMinutes, preferences, traffic?.searchMultiplier],
  );
  const stopRecommendation = useMemo(
    () => getStopRecommendation(currentOption, parkingOptions, preferences),
    [currentOption, parkingOptions, preferences],
  );
  const riskStyle = getRiskStyle(score);
  const safeMinutes =
    score > 66
      ? Math.min(durationMinutes, 30)
      : score >= 34
        ? Math.min(durationMinutes, 60)
        : durationMinutes;
  const safeUntil = new Date(now.getTime() + safeMinutes * 60_000).toLocaleTimeString(
    "en-US",
    { hour: "numeric", minute: "2-digit" },
  );
  const confidence = getConfidence(selected.count);
  const recommendation = getRecommendation(score);
  const decisionIsSearch = stopRecommendation.shouldKeepSearching;
  const decisionMoney = decisionIsSearch
    ? Math.max(1, Math.round(stopRecommendation.modeledExposureReduction))
    : selected.avgFine;
  const decisionMinutes = decisionIsSearch
    ? Math.max(1, stopRecommendation.additionalSearchMinutes)
    : preferences.maxSearchMinutes;

  function selectStreet(value: string, announce = true) {
    const match = findStreet(value);
    if (!match) {
      if (announce) setSearchMessage("Try Broadway, 5th Ave, E 18th St, or Park Ave S.");
      return false;
    }

    userInteracted.current = true;
    setLocation({ lat: match.lat, lng: match.lng });
    setQuery(match.street);
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
    const exactStreet = streetNames.find(
      (street) => street.toLowerCase() === value.trim().toLowerCase(),
    );
    if (exactStreet) selectStreet(exactStreet, false);
  }

  function handleMapClick(nextLocation: typeof FLATIRON) {
    userInteracted.current = true;
    setLocation(nextLocation);
    setQuery("");
    setSearchMessage("Map point selected");
  }

  function handleOptionSelect(street: string) {
    const alternative = parkingOptions.find((option) => option.entry.street === street);
    if (!alternative) return;
    userInteracted.current = true;
    setLocation({ lat: alternative.entry.lat, lng: alternative.entry.lng });
    setQuery(alternative.entry.street);
    setSearchMessage(`Showing recommendation: ${alternative.entry.street}`);
  }

  function handleUseMyLocation() {
    if (!userLocation) return;
    userInteracted.current = true;
    setLocation(userLocation);
    setQuery("");
    setSearchMessage("Centered on your location.");
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
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#101828] text-lg font-black text-white shadow-[0_10px_30px_rgba(16,24,40,0.2)]">
          P
        </div>
        <div className="rounded-xl bg-white/95 px-3 py-2 shadow-[0_10px_30px_rgba(16,24,40,0.15)] backdrop-blur">
          <p className="text-[15px] font-black tracking-[-0.04em] text-[#101828]">
            ticket<span className="text-[#ff5a3c]">dodge</span>
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSearch}
        className="absolute left-1/2 top-[72px] z-[1000] w-[calc(100%-32px)] max-w-[460px] -translate-x-1/2 md:left-6 md:top-[84px] md:w-[390px] md:translate-x-0"
        role="search"
      >
        <div className="flex items-center rounded-2xl bg-white p-1.5 shadow-[0_14px_45px_rgba(16,24,40,0.18)] ring-1 ring-slate-900/5 transition focus-within:ring-2 focus-within:ring-[#ff5a3c]/60">
          <span className="relative ml-3 h-4 w-4 shrink-0" aria-hidden="true">
            <span className="absolute left-0 top-0 h-3 w-3 rounded-full border-2 border-slate-400" />
            <span className="absolute bottom-0 right-0 h-1.5 w-0.5 rotate-[-45deg] rounded-full bg-slate-400" />
          </span>
          <label htmlFor="street-search" className="sr-only">
            Search a Flatiron street
          </label>
          <input
            id="street-search"
            list="street-options"
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            placeholder="Try Broadway or 5th Ave"
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
            Check curb
          </button>
        </div>
        <div className="mt-2 flex min-h-8 items-center justify-between gap-2 pl-2">
          <p className="rounded-full bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm backdrop-blur" aria-live="polite">
            {searchMessage || "Search a street or tap a curb on the map."}
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
        className="risk-panel absolute bottom-0 right-0 z-[1200] h-[64vh] w-full overscroll-contain overflow-y-auto rounded-t-[28px] border-t border-white/10 bg-[#101828] px-5 pb-6 pt-4 text-white shadow-[0_-15px_50px_rgba(16,24,40,0.3)] md:top-0 md:h-full md:w-[420px] md:rounded-none md:border-l md:border-t-0 md:px-8 md:pb-8 md:pt-7 md:shadow-[-18px_0_50px_rgba(16,24,40,0.16)]"
        aria-live="polite"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20 md:hidden" />

        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#ff9d8b]">
              Your parking plan
            </p>
            <h1 className="mt-1 text-lg font-bold tracking-tight md:text-xl">{selected.street}</h1>
            <p className="mt-1 text-xs text-slate-500">Selected curb near Flatiron</p>
          </div>
          <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">
            {currentDay.slice(0, 3)} · {formatHour(currentHour)}
          </span>
        </header>

        <section
          className="mt-3 grid grid-cols-3 overflow-hidden rounded-xl border border-white/10 bg-black/10"
          aria-label="Data sources"
        >
          <div className="border-r border-white/10 px-2.5 py-2">
            <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> NYC data
            </p>
            <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-400">
              {totalTickets.toLocaleString()} tickets
            </p>
          </div>
          <a
            href={traffic?.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="border-r border-white/10 px-2.5 py-2 transition hover:bg-white/5"
            title={traffic?.linkName}
          >
            <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-sky-300">
              <span className={`h-1.5 w-1.5 rounded-full ${traffic?.available ? "animate-pulse bg-sky-400" : "bg-slate-600"}`} /> DOT feed
            </p>
            <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-400">
              {traffic?.available ? `${traffic.speedMph} mph · ${traffic.label}` : traffic?.label ?? "Loading…"}
            </p>
          </a>
          <div className="px-2.5 py-2">
            <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-violet-300">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" /> Model
            </p>
            <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-400">Risk + opportunity</p>
          </div>
        </section>

        <fieldset className="mt-4 md:mt-5">
          <legend className="flex w-full items-center justify-between text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
            <span>How long are you parking?</span>
            <span className="normal-case tracking-normal text-slate-600">Changes your estimate</span>
          </legend>
          <div className="mt-2 grid grid-cols-3 gap-2 rounded-2xl bg-white/[0.06] p-1.5">
            {durationOptions.map((minutes) => {
              const selectedDuration = minutes === durationMinutes;
              return (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={selectedDuration}
                  onClick={() => setDurationMinutes(minutes)}
                  className={`rounded-xl px-3 py-2 text-xs font-bold transition focus:outline-none focus:ring-2 focus:ring-[#ff5a3c] ${
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

        <section
          className={`relative mt-3 overflow-hidden rounded-[24px] border p-4 md:p-5 ${
            decisionIsSearch
              ? "border-[#ff9d3c]/30 bg-[#ff9d3c]/[0.09]"
              : "border-emerald-400/25 bg-emerald-400/[0.08]"
          }`}
        >
          <div
            className={`absolute -right-8 -top-10 h-28 w-28 rounded-full blur-2xl ${
              decisionIsSearch ? "bg-[#ff9d3c]/15" : "bg-emerald-400/10"
            }`}
          />
          <div className="relative flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${decisionIsSearch ? "text-[#ffc27b]" : "text-emerald-300"}`}>
                Best next move
              </p>
              <h2 className="mt-1 text-2xl font-black tracking-[-0.045em] text-white">
                {decisionIsSearch
                  ? `Try ${stopRecommendation.betterOption?.entry.street}`
                  : "Park here"}
              </h2>
              <p className="mt-1 max-w-[280px] text-xs font-medium leading-relaxed text-slate-300">
                {stopRecommendation.message}
              </p>
            </div>
            <span className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wider ${decisionIsSearch ? "bg-[#ff9d3c]/15 text-[#ffc27b]" : "bg-emerald-400/15 text-emerald-300"}`}>
              {decisionIsSearch ? "Search" : "Stop"}
            </span>
          </div>

          <div className="relative mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-white/10 bg-black/15 px-3 py-2.5">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                {decisionIsSearch ? "Modeled reduction" : "Fine at stake"}
              </p>
              <p className="mt-0.5 text-xl font-black text-white">${decisionMoney}</p>
              <p className="text-[9px] font-semibold text-slate-500">
                {decisionIsSearch ? "estimate" : "NYC schedule"}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/15 px-3 py-2.5">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                {decisionIsSearch ? "Next option" : "Circling avoided"}
              </p>
              <p className="mt-0.5 text-xl font-black text-white">
                {decisionIsSearch ? `≈${decisionMinutes}` : `≤${decisionMinutes}`} min
              </p>
              <p className="text-[9px] font-semibold text-slate-500">modeled time</p>
            </div>
          </div>

          {decisionIsSearch && stopRecommendation.betterOption ? (
            <button
              type="button"
              onClick={() => handleOptionSelect(stopRecommendation.betterOption!.entry.street)}
              className="relative mt-3 w-full rounded-xl bg-white px-4 py-2.5 text-xs font-black text-[#101828] transition hover:-translate-y-0.5 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#ff9d3c] focus:ring-offset-2 focus:ring-offset-[#101828]"
            >
              Show {stopRecommendation.betterOption.entry.street} on map →
            </button>
          ) : null}
        </section>

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
            <p className="text-[11px] font-bold uppercase tracking-[0.17em] text-slate-400">Enforcement risk index</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${riskStyle.pill}`}>
                {riskStyle.label}
              </span>
              <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-slate-300">
                {confidence} data depth
              </span>
            </div>
            <p className="mt-2 max-w-[210px] text-xs leading-relaxed text-slate-400 md:text-sm">
              Relative exposure for a {formatDuration(durationMinutes).toLowerCase()} stay—not a ticket probability.
            </p>
          </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-4 border-t border-white/10 pt-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Recheck by</p>
              <p className="mt-1 text-xs font-semibold text-slate-300">{recommendation}</p>
            </div>
            <p className="text-2xl font-black tracking-tight text-white">{safeUntil}</p>
          </div>
        </section>

        <section className="mt-3 rounded-2xl border border-white/10 bg-black/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-bold text-white">Best nearby curbs</h2>
            <span className="rounded-full bg-violet-400/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-violet-300">Modeled cost</span>
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
                  <span className="min-w-0"><span className="mr-2 text-[10px] font-black text-emerald-300">#{index + 1}</span><span className="text-xs font-bold text-white">{option.entry.street}</span></span>
                  <span className="text-sm font-black text-emerald-300">≈${option.totalExpectedCost.toFixed(0)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] font-semibold text-slate-500">
                  <span>{option.availability}/100 opportunity</span>
                  <span>{option.ticketRisk}/100 risk</span>
                  <span>≈{option.searchMinutes} min search</span>
                  <span>{option.blocksAway} {option.blocksAway === 1 ? "block" : "blocks"}</span>
                </div>
              </button>
            ))}
          </div>
          {parkingOptions.length === 0 ? (
            <p className="mt-3 rounded-xl bg-white/[0.04] px-3 py-3 text-xs text-slate-400">
              No modeled curb falls within your current walking limit. Increase it in Parking preferences.
            </p>
          ) : null}
          <p className="mt-3 border-t border-white/10 pt-3 text-[10px] leading-relaxed text-slate-500">
            Current curb: {currentOption.availability}/100 opportunity · {currentOption.restriction}. ≈${currentOption.totalExpectedCost.toFixed(0)} combines meter cost, modeled fine/tow exposure, and the time cost of walking or searching.
          </p>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-600">
            Opportunity is an estimate from citation intensity and time-of-day pressure. The NYC DOT speed snapshot adjusts search time only; it does not change ticket risk.
          </p>
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
              Model
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
            <span className="flex items-center gap-2">
              Historical context
              <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-emerald-300">NYC data</span>
            </span>
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
                <span className="shrink-0 text-[#ff9d8b]">${selected.avgFine} scheduled fine</span>
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
          . DOT speeds are the latest public snapshot; opportunity, time, and risk are labeled model outputs. Map points are representative. Always follow posted signs.
        </p>
      </aside>
    </main>
  );
}

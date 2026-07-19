"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TicketMap from "@/components/TicketMap";
import { geocode, type GeocodeResult } from "@/lib/geocode";
import {
  DAYS,
  STATUS_TONES,
  candidateSegments,
  formatHour,
  getById,
  nearbySegments,
  oppositeSide,
  segmentCenter,
  segments,
  snapToSegment,
  getSegmentStatus,
  type LatLng,
  type Segment,
  type StatusTone,
} from "@/lib/segments";
import { getConfidence, getRiskBreakdown, getSegmentRisk, getVerdict } from "@/lib/score";

const FLATIRON: LatLng = { lat: 40.7411, lng: -73.9897 };
const DURATIONS = [30, 60, 120];
const TIME_PRESETS = [
  { label: "Now", minutes: 0 },
  { label: "+30m", minutes: 30 },
  { label: "+1h", minutes: 60 },
  { label: "+2h", minutes: 120 },
];
const FUZZY_ACCURACY_M = 30;

function formatDuration(minutes: number) {
  return minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`;
}

function ToneBadge({ tone, size = "sm" }: { tone: StatusTone; size?: "sm" | "lg" }) {
  const t = STATUS_TONES[tone];
  const dim = size === "lg" ? "h-6 w-6 text-[13px]" : "h-4 w-4 text-[10px]";
  return (
    <span
      className={`tone-swatch tone-${t.shape} ${dim} inline-grid shrink-0 place-items-center font-black text-white`}
      style={{ backgroundColor: t.color }}
      aria-hidden="true"
    >
      <span className="tone-glyph">{t.icon}</span>
    </span>
  );
}

export default function TicketDodgeApp() {
  const now = useMemo(() => new Date(), []);
  const [selectedId, setSelectedId] = useState<string>(() => snapToSegment(FLATIRON.lat, FLATIRON.lng).id);
  const [focus, setFocus] = useState<LatLng | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [timeOffset, setTimeOffset] = useState(0);

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);

  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<Segment[] | null>(null);
  const [status, setStatusMessage] = useState("Tap a curb, search an address, or locate yourself.");

  const watchIdRef = useRef<number | null>(null);
  const skipFetchRef = useRef(false);

  // Effective time = now shifted by the scrubber. Drives every status/colour.
  const effective = useMemo(() => new Date(now.getTime() + timeOffset * 60_000), [now, timeOffset]);
  const dayIdx = effective.getDay();
  const hour = effective.getHours() + effective.getMinutes() / 60;

  const toneById = useMemo(() => {
    const map: Record<string, StatusTone> = {};
    for (const segment of segments) {
      map[segment.id] = getSegmentStatus(segment, dayIdx, hour, durationMinutes).tone;
    }
    return map;
  }, [dayIdx, hour, durationMinutes]);

  const selected = getById(selectedId) ?? segments[0];
  const selectedStatus = useMemo(
    () => getSegmentStatus(selected, dayIdx, hour, durationMinutes),
    [selected, dayIdx, hour, durationMinutes],
  );
  const score = useMemo(
    () => getSegmentRisk(selected, selectedStatus, durationMinutes),
    [selected, selectedStatus, durationMinutes],
  );
  const breakdown = useMemo(
    () => getRiskBreakdown(selected, selectedStatus, durationMinutes),
    [selected, selectedStatus, durationMinutes],
  );
  const nearby = useMemo(
    () => nearbySegments(selected, dayIdx, hour, durationMinutes, 4),
    [selected, dayIdx, hour, durationMinutes],
  );
  const safeUntil = formatHour(selectedStatus.changesAt ?? hour + durationMinutes / 60);
  const verdict = useMemo(
    () => getVerdict(score, selectedStatus, safeUntil),
    [score, selectedStatus, safeUntil],
  );
  const opposite = useMemo(() => oppositeSide(selected), [selected]);

  const selectSegment = useCallback((id: string, message?: string) => {
    const segment = getById(id);
    if (!segment) return;
    setSelectedId(id);
    setFocus(segmentCenter(segment));
    setCandidates(null);
    setStatusMessage(message ?? segment.label);
  }, []);

  const handleRoughTap = useCallback(
    (location: LatLng) => {
      const snapped = snapToSegment(location.lat, location.lng);
      selectSegment(snapped.id, `Snapped to ${snapped.label}`);
    },
    [selectSegment],
  );

  // Geocoding autocomplete — debounced, abortable.
  useEffect(() => {
    if (skipFetchRef.current) {
      skipFetchRef.current = false;
      return;
    }
    if (query.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const results = await geocode(query, controller.signal);
      setSuggestions(results);
      setActiveSuggestion(-1);
      setShowSuggestions(true);
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  function pickSuggestion(result: GeocodeResult) {
    skipFetchRef.current = true;
    setQuery(result.label);
    setSuggestions([]);
    setShowSuggestions(false);
    const snapped = snapToSegment(result.lat, result.lng);
    setSelectedId(snapped.id);
    setFocus({ lat: result.lat, lng: result.lng });
    setCandidates(null);
    setStatusMessage(`Snapped to ${snapped.label}`);
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestion((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestion((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      pickSuggestion(suggestions[Math.max(0, activeSuggestion)]);
    } else if (event.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  const locateMe = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatusMessage("Location isn't available on this device — search or tap instead.");
      return;
    }
    setStatusMessage("Locating…");
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const loc = { lat: coords.latitude, lng: coords.longitude };
        setUserLocation(loc);
        setAccuracy(coords.accuracy);
        setFocus(loc);
        if (coords.accuracy > FUZZY_ACCURACY_M) {
          setCandidates(candidateSegments(loc.lat, loc.lng, 3));
          setStatusMessage(
            `GPS is fuzzy here (±${Math.round(coords.accuracy)}m) — confirm your block below.`,
          );
        } else {
          const snapped = snapToSegment(loc.lat, loc.lng);
          setSelectedId(snapped.id);
          setCandidates(null);
          setStatusMessage(`You're on ${snapped.label}`);
        }
      },
      (error) => {
        setStatusMessage(
          error.code === error.PERMISSION_DENIED
            ? "Location permission denied — search or tap a curb instead."
            : "Couldn't get a GPS fix — search or tap a curb instead.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 12_000 },
    );
  }, []);

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  const verdictTone = STATUS_TONES[verdict.tone];

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#eceae3]">
      <section className="absolute inset-0 md:right-[440px]" aria-label="Parking curb status map">
        <TicketMap
          segments={segments}
          toneById={toneById}
          selectedId={selectedId}
          userLocation={userLocation}
          accuracy={accuracy}
          focus={focus}
          onSelectSegment={(id) => selectSegment(id)}
          onRoughTap={handleRoughTap}
        />

        {/* Legend — map overlay so colours are decoded on the map itself. */}
        <div className="pointer-events-none absolute bottom-4 right-4 z-[900] hidden rounded-2xl bg-white/95 px-3.5 py-3 shadow-[0_10px_30px_rgba(16,24,40,0.18)] ring-1 ring-slate-900/5 backdrop-blur sm:block md:right-[calc(440px+16px)]">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Curb status</p>
          <ul className="space-y-1.5">
            {(["green", "blue", "yellow", "red"] as StatusTone[]).map((tone) => (
              <li key={tone} className="flex items-center gap-2">
                <ToneBadge tone={tone} />
                <span className="text-[11px] font-semibold text-slate-700">{STATUS_TONES[tone].label}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Brand */}
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

      {/* Search + locate */}
      <div className="absolute left-1/2 top-[70px] z-[1000] w-[calc(100%-32px)] max-w-[460px] -translate-x-1/2 md:left-6 md:top-[84px] md:w-[400px] md:translate-x-0">
        <div className="relative flex items-center rounded-2xl bg-white p-1.5 shadow-[0_14px_45px_rgba(16,24,40,0.18)] ring-1 ring-slate-900/5 transition focus-within:ring-2 focus-within:ring-[#ff5a3c]/60">
          <span className="relative ml-3 h-4 w-4 shrink-0" aria-hidden="true">
            <span className="absolute left-0 top-0 h-3 w-3 rounded-full border-2 border-slate-400" />
            <span className="absolute bottom-0 right-0 h-1.5 w-0.5 rotate-[-45deg] rounded-full bg-slate-400" />
          </span>
          <label htmlFor="street-search" className="sr-only">
            Search an address or intersection near Flatiron
          </label>
          <input
            id="street-search"
            role="combobox"
            aria-expanded={showSuggestions && suggestions.length > 0}
            aria-controls="search-suggestions"
            aria-autocomplete="list"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            placeholder="Try “5th Ave & 20th” or an address"
            autoComplete="off"
            className="min-h-[44px] min-w-0 flex-1 bg-transparent px-3 text-sm font-semibold text-slate-900 outline-none placeholder:font-medium placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={locateMe}
            className="mr-0.5 flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[#2563eb] px-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <span aria-hidden="true">◎</span>
            <span className="hidden sm:inline">Locate me</span>
          </button>

          {showSuggestions && suggestions.length > 0 ? (
            <ul
              id="search-suggestions"
              role="listbox"
              className="absolute left-0 right-0 top-[calc(100%+8px)] z-[1001] overflow-hidden rounded-2xl bg-white py-1.5 shadow-[0_18px_50px_rgba(16,24,40,0.22)] ring-1 ring-slate-900/5"
            >
              {suggestions.map((result, index) => (
                <li key={result.id} role="option" aria-selected={index === activeSuggestion}>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pickSuggestion(result)}
                    className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-800 ${
                      index === activeSuggestion ? "bg-slate-100" : "hover:bg-slate-50"
                    }`}
                  >
                    <span className="text-slate-400" aria-hidden="true">↳</span>
                    <span className="truncate">{result.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <p
          className="mt-2 inline-block rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm backdrop-blur"
          aria-live="polite"
        >
          {status}
        </p>
      </div>

      {/* Risk panel / bottom sheet */}
      <aside
        className="risk-panel absolute bottom-0 right-0 z-[1200] flex h-[58vh] w-full flex-col overscroll-contain rounded-t-[28px] border-t border-white/10 bg-[#101828] text-white shadow-[0_-15px_50px_rgba(16,24,40,0.3)] md:top-0 md:h-full md:w-[440px] md:rounded-none md:border-l md:border-t-0 md:shadow-[-18px_0_50px_rgba(16,24,40,0.16)]"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/25 md:hidden" />

        {/* Verdict-first block — always visible without scrolling. */}
        <div
          className="shrink-0 px-5 pb-4 pt-3 md:px-8 md:pt-7"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-300">Your parking read</p>
              <div className="mt-2 flex items-start gap-2.5">
                <ToneBadge tone={verdict.tone} size="lg" />
                <h1 className="text-[19px] font-black leading-[1.15] tracking-tight md:text-[22px]" style={{ color: verdictTone.color }}>
                  {verdict.headline}
                </h1>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-slate-200">{verdict.sub}</p>
            </div>
            <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-200">
              {DAYS[dayIdx].slice(0, 3)} · {formatHour(hour)}
            </span>
          </div>

          {/* Word-based confirmation of the snapped curb + wrong-side switch. */}
          <div className="mt-3 rounded-2xl bg-white/[0.07] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300">Selected curb</p>
            <p className="mt-1 text-[15px] font-bold leading-snug text-white">{selected.label}</p>
            {opposite ? (
              <button
                type="button"
                onClick={() => selectSegment(opposite.id, `Switched to ${opposite.label}`)}
                className="mt-2 inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-bold text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-[#ff5a3c]"
              >
                <span aria-hidden="true">⇄</span> Wrong side? Switch to {opposite.side}
              </button>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 md:px-8 md:pb-8">
          {/* Fuzzy-GPS candidate picker */}
          {candidates ? (
            <section className="mb-4 rounded-2xl border border-yellow-400/30 bg-yellow-400/[0.08] p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-yellow-200">Confirm your block</p>
              <p className="mt-1 text-xs text-slate-200">GPS put you between these — pick the right one:</p>
              <div className="mt-3 grid gap-2">
                {candidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => selectSegment(candidate.id, candidate.label)}
                    className="flex min-h-[44px] items-center gap-2 rounded-xl bg-white/[0.06] px-3 text-left text-xs font-bold text-white transition hover:bg-white/[0.12] focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  >
                    <ToneBadge tone={toneById[candidate.id] ?? "green"} />
                    <span>{candidate.label}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {/* Duration */}
          <fieldset className="mt-1">
            <legend className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-300">How long are you parking?</legend>
            <div className="mt-2 grid grid-cols-3 gap-2 rounded-2xl bg-white/[0.06] p-1.5">
              {DURATIONS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={minutes === durationMinutes}
                  onClick={() => setDurationMinutes(minutes)}
                  className={`min-h-[44px] rounded-xl px-3 text-xs font-bold transition focus:outline-none focus:ring-2 focus:ring-[#ff5a3c] ${
                    minutes === durationMinutes ? "bg-white text-[#101828] shadow-sm" : "text-slate-200 hover:bg-white/5"
                  }`}
                >
                  {formatDuration(minutes)}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Time scrubber */}
          <fieldset className="mt-4">
            <legend className="flex w-full items-center justify-between text-[10px] font-bold uppercase tracking-[0.15em] text-slate-300">
              <span>See the curb at…</span>
              <span className="normal-case tracking-normal text-slate-300">{DAYS[dayIdx].slice(0, 3)} {formatHour(hour)}</span>
            </legend>
            <div className="mt-2 grid grid-cols-4 gap-2 rounded-2xl bg-white/[0.06] p-1.5">
              {TIME_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  aria-pressed={preset.minutes === timeOffset}
                  onClick={() => setTimeOffset(preset.minutes)}
                  className={`min-h-[44px] rounded-xl px-2 text-xs font-bold transition focus:outline-none focus:ring-2 focus:ring-[#ff5a3c] ${
                    preset.minutes === timeOffset ? "bg-white text-[#101828] shadow-sm" : "text-slate-200 hover:bg-white/5"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Demoted score + move time */}
          <section className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.045] p-4">
            <div className="flex items-center gap-3">
              <ToneBadge tone={verdict.tone} size="lg" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300">Risk score</p>
                <p className="text-2xl font-black leading-none tracking-tight" style={{ color: verdictTone.color }}>
                  {score}
                  <span className="ml-0.5 text-sm font-bold text-slate-300">/100</span>
                </p>
                <p className="mt-1 text-[11px] font-semibold text-slate-300">
                  {getConfidence(selected.count)} confidence
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300">
                {selectedStatus.changesAt != null ? "Changes at" : "Clear through"}
              </p>
              <p className="text-2xl font-black tracking-tight text-white">{safeUntil}</p>
            </div>
          </section>

          {/* Nearby ranking — keyboard-navigable */}
          <section className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4">
            <h2 className="text-xs font-bold text-white">Nearby curbs</h2>
            <ul className="mt-3 space-y-2">
              {nearby.map((option) => (
                <li key={option.segment.id}>
                  <button
                    type="button"
                    onClick={() => selectSegment(option.segment.id, option.segment.label)}
                    className="flex min-h-[44px] w-full items-center gap-3 rounded-xl bg-white/[0.05] px-3 py-2 text-left transition hover:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  >
                    <ToneBadge tone={option.status.tone} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold text-white">{option.segment.label}</span>
                      <span className="block text-[11px] font-semibold text-slate-300">
                        {STATUS_TONES[option.status.tone].label} · {option.blocksAway} block{option.blocksAway === 1 ? "" : "s"} away
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Why this score */}
          <section className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4">
            <h2 className="text-xs font-bold text-white">Why this read</h2>
            <div className="mt-3 space-y-3">
              {breakdown.map((factor) => (
                <div key={factor.label}>
                  <div className="flex items-center justify-between gap-4 text-[11px]">
                    <span className="font-bold text-slate-200">{factor.label}</span>
                    <span className="truncate text-slate-300">{factor.detail}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full transition-[width] duration-300"
                      style={{ width: `${factor.strength}%`, backgroundColor: verdictTone.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Historical context */}
          <details className="mt-4 rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-bold text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5a3c]">
              Historical context
              <span className="text-base text-slate-300" aria-hidden="true">⌄</span>
            </summary>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-white/10 pt-4">
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-300">Nearby FY2026 tickets</dt>
                <dd className="mt-1 text-xl font-extrabold tracking-tight">{selected.count.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-300">Avg. fine</dt>
                <dd className="mt-1 text-xl font-extrabold tracking-tight text-[#ff9d8b]">${selected.avgFine}</dd>
              </div>
              <div className="col-span-2 border-t border-white/10 pt-4">
                <dt className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-300">Most common violation here</dt>
                <dd className="mt-1 text-sm font-bold">{selected.topViolation}</dd>
              </div>
            </dl>
          </details>

          <p className="mx-auto mt-5 max-w-xs text-center text-[11px] leading-relaxed text-slate-300">
            Curb regulations are representative demo data; ticket totals draw on{" "}
            <a
              href="https://data.cityofnewyork.us/d/pvqr-7yc4"
              target="_blank"
              rel="noreferrer"
              className="font-bold text-slate-100 underline decoration-white/30 underline-offset-2 hover:text-white"
            >
              NYC Open Data FY2026
            </a>
            . Always follow posted signs.
          </p>
        </div>
      </aside>
    </main>
  );
}

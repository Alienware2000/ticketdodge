"use client";

import dynamic from "next/dynamic";

const TicketDodgeApp = dynamic(
  () => import("@/components/TicketDodgeApp"),
  {
    ssr: false,
    loading: () => (
      <main className="grid min-h-screen place-items-center bg-[#ebe8df]">
        <div className="flex items-center gap-3 rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-lg">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#ff5a3c]" />
          Loading the Flatiron risk map…
        </div>
      </main>
    ),
  },
);

export default function Home() {
  return <TicketDodgeApp />;
}

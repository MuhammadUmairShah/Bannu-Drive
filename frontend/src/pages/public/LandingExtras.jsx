import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Bus, MapPin, Armchair, Smartphone, QrCode, Navigation, Clock } from "lucide-react";
import { images, hideBroken } from "./images";

/* ------------------------------------------------------------
   Small helpers (kept local so LandingPage.jsx stays untouched)
------------------------------------------------------------ */

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const saveData = () => typeof navigator !== "undefined" && !!navigator.connection?.saveData;

function Reveal({ children, delay = 0, className = "" }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (reducedMotion() || typeof IntersectionObserver === "undefined") { setSeen(true); return undefined; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ transitionDelay: `${delay}ms` }}
      className={`transition duration-700 ease-out motion-reduce:transition-none ${seen ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"} ${className}`}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------
   1. Thin progress bar at the top of the page
------------------------------------------------------------ */

export function ScrollProgress() {
  const bar = useRef(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      if (bar.current) bar.current.style.transform = `scaleX(${p})`;
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); if (frame) cancelAnimationFrame(frame); };
  }, []);
  return <div aria-hidden="true" ref={bar} className="fixed inset-x-0 top-0 z-[60] h-0.5 origin-left scale-x-0 bg-mint" />;
}

/* ------------------------------------------------------------
   2. Background media: photo first, video fades in on top when it can play.
      `src` can be ONE url or a LIST. The list is tried in order, so put your own file first:
        ["/videos/hero.mp4", "https://...remote fallback.mp4"]
      Falls back to the photo if every source fails, the user prefers reduced motion, or Data Saver is on.
------------------------------------------------------------ */

export function HeroMedia({ poster, alt = "", src = "/videos/hero.mp4", priority = false }) {
  const sources = (Array.isArray(src) ? src : [src]).filter(Boolean);
  const [skip, setSkip] = useState(() => reducedMotion() || saveData());
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const current = sources[index];

  const failed = () => {
    setPlaying(false);
    if (index + 1 < sources.length) setIndex(index + 1);
    else setSkip(true);
  };

  return (
    <>
      <img src={poster} alt={alt} fetchPriority={priority ? "high" : undefined} loading={priority ? undefined : "lazy"} onError={hideBroken}
        className="img-dim bd-drift absolute inset-0 -z-30 h-full w-full object-cover" />
      {!skip && current && (
        <video key={current} src={current} poster={poster} autoPlay muted loop playsInline preload="metadata" aria-hidden="true" tabIndex={-1}
          onPlaying={() => setPlaying(true)} onError={failed}
          className={`img-dim absolute inset-0 -z-30 h-full w-full object-cover transition-opacity duration-1000 ${playing ? "opacity-100" : "opacity-0"}`} />
      )}
    </>
  );
}

/* ------------------------------------------------------------
   3. Scrolling strip of local places
------------------------------------------------------------ */

export function PlacesMarquee({ items = [] }) {
  if (!items.length) return null;
  const row = (hidden) => (
    <ul aria-hidden={hidden || undefined} className="flex shrink-0 items-center gap-10 pr-10">
      {items.map((p) => (
        <li key={`${hidden ? "b" : "a"}-${p}`} className="flex items-center gap-2 whitespace-nowrap text-sm font-medium text-white/80">
          <MapPin className="h-4 w-4 text-mint" />{p}
        </li>
      ))}
    </ul>
  );
  return (
    <section aria-label="Places we serve" className="group overflow-hidden bg-navy py-4 text-white">
      <style>{`
        @keyframes bd-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .bd-marquee { animation: bd-marquee 38s linear infinite; }
        .group:hover .bd-marquee { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) { .bd-marquee { animation: none; } }
      `}</style>
      <div className="bd-marquee flex w-max" style={{ maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)" }}>
        {row(false)}{row(true)}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------
   4. Intercity coaches section: video background + live-style departure board
------------------------------------------------------------ */

const STOPS = ["Bannu", "Kohat", "Peshawar"];
const POINTS = [
  { icon: Armchair, text: "Pick your exact seat on the seat map" },
  { icon: Navigation, text: "Track your coach live after you book" },
  { icon: Smartphone, text: "Pay with EasyPaisa, JazzCash or cash" },
  { icon: QrCode, text: "Get a QR ticket on your phone" },
];

// Illustration only; the real list is on the coaches page
const SAMPLE = [
  { time: "12:00 PM", operator: "Adil Coaches", to: "Peshawar", fare: "1,200", status: "Boarding soon" },
  { time: "01:00 PM", operator: "Express Coaches", to: "Peshawar", fare: "1,200", status: "On time" },
  { time: "06:30 PM", operator: "Evening Express", to: "Islamabad", fare: "2,400", status: "On time" },
];

function DepartureBoard() {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-3xl bg-ink/60 shadow-2xl shadow-black/30 ring-1 ring-white/15 backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
        <p className="flex items-center gap-2 font-display text-sm font-bold">
          <Clock className="h-4 w-4 text-mint" /> Departures from Bannu
        </p>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-mint/15 px-2.5 py-1 text-[11px] font-semibold text-mint">
          <span className="relative flex h-2 w-2">
            <span className="bd-ping absolute inline-flex h-full w-full rounded-full bg-mint" />
            <span className="relative h-2 w-2 rounded-full bg-mint" />
          </span>
          Live tracking
        </span>
      </div>

      {/* animated route */}
      <div className="px-5 pt-5 sm:px-6">
        <div className="relative h-10">
          <div className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-white/25" />
          <div className="bd-drive absolute inset-x-0 top-0 text-mint"><Bus className="h-8 w-8" /></div>
        </div>
        <div className="mt-1 flex justify-between">
          {STOPS.map((s, i) => (
            <div key={s} className="flex flex-col items-center gap-1.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="bd-ping absolute inline-flex h-full w-full rounded-full bg-mint" style={{ animationDelay: `${i * 0.6}s` }} />
                <span className="relative h-2.5 w-2.5 rounded-full bg-mint" />
              </span>
              <span className="text-[11px] font-medium text-white/70">{s}</span>
            </div>
          ))}
        </div>
      </div>

      <ul className="mt-5 divide-y divide-white/10 border-t border-white/10">
        {SAMPLE.map((r) => (
          <li key={r.time} className="flex items-center justify-between gap-4 px-5 py-3.5 sm:px-6">
            <div className="flex items-center gap-4">
              <span className="w-[4.5rem] font-display text-base font-extrabold tabular-nums">{r.time}</span>
              <div className="leading-tight">
                <p className="text-sm font-semibold">{r.operator}</p>
                <p className="text-xs text-white/60">to {r.to}</p>
              </div>
            </div>
            <div className="text-right leading-tight">
              <p className="text-sm font-bold text-mint">PKR {r.fare}</p>
              <p className="text-[11px] text-white/60">{r.status}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="border-t border-white/10 px-5 py-3 text-center text-[11px] text-white/45 sm:px-6">Sample schedule. See the coaches page for real times and seats.</p>
    </div>
  );
}

export function IntercitySection({ video }) {
  return (
    <section id="coaches" className="relative isolate overflow-hidden bg-ink py-20 text-white sm:py-28">
      <HeroMedia poster={images.bus} src={video} alt="" />
      <div className="absolute inset-0 -z-20 bg-gradient-to-r from-ink/95 via-ink/80 to-ink/50" />
      <div className="container-x grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <Reveal>
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-xs font-semibold backdrop-blur">
            <Bus className="h-4 w-4 text-mint" /> Intercity coaches
          </p>
          <h2 className="mt-5 text-3xl font-extrabold leading-tight sm:text-4xl lg:text-5xl">Leaving Bannu? Book your seat in advance.</h2>
          <p className="mt-4 max-w-lg text-base leading-7 text-white/75">See which coaches are running, compare departure times and choose a seat before you reach the stand.</p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 rounded-2xl bg-white/5 p-3 text-sm font-medium ring-1 ring-white/10">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-brand/25 text-mint"><Icon className="h-4 w-4" /></span>{text}
              </li>
            ))}
          </ul>
          <Link to="/coaches" className="btn btn-primary bd-shine group relative mt-8 overflow-hidden">
            See Active Coaches <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
          </Link>
        </Reveal>
        <Reveal delay={200}><DepartureBoard /></Reveal>
      </div>
    </section>
  );
}
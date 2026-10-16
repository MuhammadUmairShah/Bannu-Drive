import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  MapPin, Navigation, Car, Bike, Bus, ArrowRight, ShieldCheck, Wallet, MousePointerClick,
  Map as MapIcon, Headphones, Ticket, CalendarDays, Minus, Plus, Search, BadgeCheck, Sparkles,
  Route, CheckCircle2, Check, ChevronDown, Clock, Banknote, IdCard,
} from "lucide-react";
import Navbar, { BOOK_ROUTE } from "./Navbar";
import Footer from "./Footer";
import { RickshawIcon } from "./Logo";
import { images, hideBroken } from "./images";
import { ScrollProgress, HeroMedia, PlacesMarquee, IntercitySection } from "./LandingExtras";

/* ============================== DATA ============================== */

// Free stock clip (Mixkit Stock Video Free License). For production, download it and host it yourself:
// put the file at public/videos/buses.mp4 and change this to "/videos/buses.mp4".
const HERO_VIDEO = "https://assets.mixkit.co/videos/50261/50261-720.mp4";

const LOCAL_PLACES = ["Bannu City Center", "Bannu Cantt", "Chowk Bazaar", "Miranshah Road", "UST Bannu Main Campus", "DHQ Hospital"];
const COACH_CITIES = ["Bannu", "Peshawar", "Islamabad", "Rawalpindi", "Lahore", "Dera Ismail Khan", "Kohat"];

const SERVICES = [
  { id: "bike", label: "Bike", icon: Bike, baseFare: 150 },
  { id: "rickshaw", label: "Rickshaw", icon: RickshawIcon, baseFare: 250 },
  { id: "car", label: "Car", icon: Car, baseFare: 450 },
  { id: "bus", label: "Bus / Coach", icon: Bus },
];

const TRUST = [
  { icon: ShieldCheck, title: "Safe Rides", text: "Verified Drivers" },
  { icon: Wallet, title: "Affordable Fares", text: "Fair Local Pricing" },
  { icon: MousePointerClick, title: "Quick Booking", text: "Book in Few Clicks" },
  { icon: Headphones, title: "24/7 Support", text: "Always Here to Help" },
];

const RIDES = [
  { id: "bike", image: images.bike, icon: Bike, title: "Bike", tag: "Fast & Affordable", cta: "Book Now" },
  { id: "rickshaw", image: images.rickshaw, icon: RickshawIcon, title: "Rickshaw", tag: "Local & Comfortable", cta: "Book Now" },
  { id: "car", image: images.car, icon: Car, title: "Car", tag: "Comfortable & Reliable", cta: "Book Now" },
  { id: "bus", image: images.bus, icon: Bus, title: "Bus / Coach", tag: "Long Distance Travel", cta: "Book Ticket" },
];

const WHY = [
  { icon: BadgeCheck, title: "Trusted Drivers", text: "Drivers are verified before they can accept a single ride." },
  { icon: Wallet, title: "Affordable Pricing", text: "Offer a fare that works for you and pay what was agreed. Nothing hidden." },
  { icon: MousePointerClick, title: "Easy Booking", text: "Pick a ride, set pickup and drop-off, and confirm in a few taps." },
  { icon: MapIcon, title: "Local Coverage", text: "Built around Bannu's roads, landmarks and the way the city moves." },
  { icon: Headphones, title: "Reliable Support", text: "Questions or a problem on a trip? Our team is here to help." },
  { icon: Sparkles, title: "Modern Experience", text: "A clean, simple booking flow that works on any phone." },
];

const STEPS = [
  { icon: Car, title: "Choose Your Ride", text: "Bike, rickshaw, car or a coach seat." },
  { icon: Route, title: "Enter Your Destination", text: "Tell us where you are and where you're headed." },
  { icon: Ticket, title: "Confirm Your Booking", text: "Review the fare and confirm your request." },
  { icon: CheckCircle2, title: "Enjoy Your Journey", text: "Meet your driver and travel with confidence." },
];

const DRIVER_PERKS = [
  { icon: Banknote, text: "Choose the fares you accept" },
  { icon: Clock, text: "Drive whenever you want" },
  { icon: IdCard, text: "Simple one-time verification" },
];

const FAQS = [
  { q: "How does the fare offer work?", a: "You enter the fare you are willing to pay. Nearby drivers see it and can accept it. You always know the price before the ride starts." },
  { q: "Are the drivers verified?", a: "Yes. Every driver is checked before they can accept their first ride." },
  { q: "Can I book a coach seat in advance?", a: "Yes. Choose Bus / Coach, pick your cities and travel date, then confirm your seat." },
  { q: "Which areas do you cover?", a: "Bannu City and Bannu Cantt, including Chowk Bazaar, Miranshah Road and the UST campus. Coaches also run to nearby cities." },
  { q: "What if I have a problem during a trip?", a: "Contact our support team from the Contact page." },
];

/* ============================ ANIMATION HELPERS ============================ */

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Fires once when the element scrolls into view. */
function useInView(threshold = 0.2) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced() || typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen];
}

/** Fade + slide-up on scroll. Use `delay` (ms) to stagger siblings. */
function Reveal({ children, delay = 0, className = "", as: Tag = "div" }) {
  const [ref, seen] = useInView(0.15);
  return (
    <Tag
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition duration-700 ease-out motion-reduce:transition-none ${seen ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"} ${className}`}
    >
      {children}
    </Tag>
  );
}

/** Keyframes used across the page. */
function AnimationStyles() {
  return (
    <style>{`
      @keyframes bd-drive { 0% { transform: translateX(-12%); } 100% { transform: translateX(112%); } }
      @keyframes bd-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
      @keyframes bd-ping  { 0% { transform: scale(.8); opacity: .7; } 100% { transform: scale(2.2); opacity: 0; } }
      @keyframes bd-shine { 0% { transform: translateX(-120%); } 100% { transform: translateX(220%); } }
      .bd-drive { animation: bd-drive 9s linear infinite; }
      .bd-float { animation: bd-float 4s ease-in-out infinite; }
      .bd-ping  { animation: bd-ping 2.2s ease-out infinite; }
      .bd-shine::after { content:""; position:absolute; inset:0; width:40%; background:linear-gradient(100deg,transparent,rgba(255,255,255,.25),transparent); animation: bd-shine 3.5s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce) {
        .bd-drive, .bd-float, .bd-ping, .bd-shine::after { animation: none !important; }
      }
    `}</style>
  );
}

/* ============================ HERO + BOOKING ============================ */

function BookingPanel() {
  const navigate = useNavigate();
  const [service, setService] = useState("bike");
  const [pickup, setPickup] = useState("Bannu City Center");
  const [destination, setDestination] = useState("Bannu Cantt");
  const [fare, setFare] = useState(150);
  const [date, setDate] = useState("");

  const isBus = service === "bus";
  const today = new Date().toISOString().split("T")[0];
  const ready = pickup.trim() && destination.trim() && (!isBus || date);

  const pick = (s) => {
    setService(s.id);
    if (s.baseFare) setFare(s.baseFare);
  };

  const submit = (e) => {
    e.preventDefault();
    if (!ready) return;
    navigate(BOOK_ROUTE, { state: { service, pickup, destination, fare: isBus ? null : fare, date } });
  };

  return (
    <form onSubmit={submit} aria-label="Book a ride or coach ticket" className="bd-rise rounded-3xl bg-surface p-4 shadow-[0_30px_80px_-20px_rgba(6,44,44,0.45)] ring-1 ring-line sm:p-6" style={{ animationDelay: "250ms" }}>
      <div role="tablist" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SERVICES.map((s) => {
          const Icon = s.icon;
          const active = service === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => pick(s)}
              className={`flex items-center justify-center gap-2.5 rounded-xl border px-3 py-3 text-sm font-semibold transition duration-200 active:scale-95 ${
                active ? "border-brand bg-brand text-white shadow-md shadow-brand/30" : "border-line bg-surface text-muted hover:border-brand/50 hover:text-fg"
              }`}
            >
              <Icon className={`h-5 w-5 transition duration-300 ${active ? "scale-110" : ""}`} />
              {s.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_0.8fr_auto]">
        <div className="relative">
          <MapPin className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-link" />
          <input list={isBus ? "coach-cities" : "local-places"} value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder={isBus ? "Leaving from" : "Pickup location"} aria-label="Pickup" className="input" />
        </div>
        <div className="relative">
          <Navigation className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-fg" />
          <input list={isBus ? "coach-cities" : "local-places"} value={destination} onChange={(e) => setDestination(e.target.value)} placeholder={isBus ? "Going to" : "Where to?"} aria-label="Destination" className="input" />
        </div>

        {isBus ? (
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-subtle" />
            <input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Travel date" className="input" />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3 py-1.5">
            <div className="leading-tight">
              <p className="text-[11px] text-muted">Your fare</p>
              {/* key remounts the node on change so the bump animation replays */}
              <p key={fare} className="bd-rise text-base font-extrabold text-fg" style={{ animationDuration: "250ms" }}>PKR {fare}</p>
            </div>
            <div className="flex gap-1.5">
              <button type="button" aria-label="Decrease fare by 50" onClick={() => setFare((f) => Math.max(50, f - 50))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-muted transition hover:bg-surface-2 active:scale-90">
                <Minus className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Increase fare by 50" onClick={() => setFare((f) => f + 50)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-muted transition hover:bg-surface-2 active:scale-90">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <button type="submit" disabled={!ready} className="btn btn-primary group w-full !py-3 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none lg:w-auto lg:px-8">
          <Search className="h-4 w-4 transition group-hover:scale-110" />
          Search Ride
        </button>
      </div>

      <datalist id="local-places">{LOCAL_PLACES.map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id="coach-cities">{COACH_CITIES.map((p) => <option key={p} value={p} />)}</datalist>
    </form>
  );
}

function Hero() {
  return (
    <section className="relative isolate flex min-h-[88vh] items-center overflow-hidden bg-ink text-white">
      {/* photo first, bus video fades in on top when public/videos/buses.mp4 exists */}
      <HeroMedia poster={images.hero} src={HERO_VIDEO} alt="Road journey at dusk" priority />
      <div className="absolute inset-0 -z-20 bg-gradient-to-r from-ink/95 via-ink/70 to-ink/20" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-48 bg-gradient-to-t from-ink/90 to-transparent" />

      {/* Moving vehicle along the bottom edge of the hero (the mover is as wide as the road, so it crosses it) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-28 -z-10 hidden h-10 overflow-hidden opacity-70 lg:block">
        <div className="bd-drive absolute inset-x-0 bottom-0 text-mint"><RickshawIcon className="h-8 w-8" /></div>
        <div className="absolute inset-x-0 bottom-0 border-t-2 border-dashed border-white/20" />
      </div>

      <div className="container-x pb-44 pt-32 sm:pb-48 lg:pb-52 lg:pt-36">
        <div className="bd-rise max-w-3xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-surface/20 bg-surface/10 px-4 py-1.5 text-xs font-semibold text-white/90 backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="bd-ping absolute inline-flex h-full w-full rounded-full bg-mint" />
              <span className="relative h-2 w-2 rounded-full bg-mint" />
            </span>
            Now serving Bannu City &amp; Cantt
          </p>
          <h1 className="mt-6 text-[2.75rem] font-extrabold leading-[1.02] sm:text-6xl lg:text-[5.25rem]">
            <span className="bd-rise block" style={{ animationDelay: "100ms" }}>Your Journey.</span>
            <span className="bd-rise block text-mint" style={{ animationDelay: "250ms" }}>Your Fare.</span>
            <span className="bd-rise block text-mint" style={{ animationDelay: "400ms" }}>Your Choice.</span>
          </h1>
          <p className="bd-rise mt-6 max-w-xl text-base leading-7 text-white/85 sm:text-lg sm:leading-8" style={{ animationDelay: "550ms" }}>
            Safe, affordable and convenient transportation across Bannu City and Cantt. Book your ride or reserve your bus ticket in just a few clicks.
          </p>
          <div className="bd-rise mt-9 flex flex-col gap-3 sm:flex-row" style={{ animationDelay: "700ms" }}>
            <Link to={BOOK_ROUTE} className="btn btn-primary group">Book a Ride <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></Link>
            <Link to="/services" className="btn btn-glass">Explore Services</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================ SECTIONS ============================ */

function Trust() {
  return (
    <section className="bg-surface pb-6 pt-14 sm:pt-16 lg:pt-20">
      <div className="container-x grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4 lg:divide-x lg:divide-line">
        {TRUST.map(({ icon: Icon, title, text }, i) => (
          <Reveal key={title} delay={i * 90} className="group flex flex-col items-start gap-3 sm:flex-row sm:items-center lg:px-8 lg:first:pl-0">
            <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-link ring-1 ring-brand/15 transition duration-300 group-hover:-rotate-6 group-hover:scale-110 group-hover:bg-brand group-hover:text-white">
              <Icon className="h-7 w-7" strokeWidth={1.6} />
            </span>
            <div>
              <h3 className="font-display text-base font-bold text-fg sm:text-lg">{title}</h3>
              <p className="text-sm text-muted">{text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function RideCard({ ride }) {
  const navigate = useNavigate();
  const Icon = ride.icon;
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-3xl bg-surface shadow-[0_10px_40px_-15px_rgba(6,44,44,0.25)] ring-1 ring-line/70 transition duration-300 hover:-translate-y-1.5 hover:shadow-[0_24px_60px_-18px_rgba(6,44,44,0.35)]">
      <div className="relative h-56 overflow-hidden bg-navy">
        <img src={ride.image} alt={`${ride.title} service`} loading="lazy" onError={hideBroken} className="img-dim h-full w-full object-cover transition duration-700 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-transparent" />
        <span className="absolute bottom-4 left-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-white shadow-lg transition duration-300 group-hover:-translate-y-1 group-hover:rotate-6">
          <Icon className="h-6 w-6" />
        </span>
      </div>
      <div className="flex flex-1 flex-col p-6">
        <h3 className="text-2xl font-extrabold text-fg">{ride.title}</h3>
        <p className="mt-1 text-sm font-medium text-muted">{ride.tag}</p>
        <div className="mt-5 border-t border-line pt-5">
          <span className="text-sm text-muted">{ride.id === "bus" ? "Fare set by each operator" : "You offer your fare"}</span>
        </div>
        <button type="button" onClick={() => navigate(BOOK_ROUTE, { state: { service: ride.id } })} className="btn btn-dark mt-5 w-full">
          {ride.cta}
          <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
        </button>
      </div>
    </article>
  );
}

function Rides() {
  return (
    <section id="rides" className="section bg-surface">
      <div className="container-x">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="h2">Choose Your Ride</h2>
          <p className="lead mt-4">Travel your way with convenient options for every journey.</p>
        </Reveal>
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {RIDES.map((r, i) => <Reveal key={r.id} delay={i * 110}><RideCard ride={r} /></Reveal>)}
        </div>
      </div>
    </section>
  );
}

function AboutPreview() {
  return (
    <section className="section bg-bg">
      <div className="container-x grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <Reveal className="relative">
          <div className="absolute -left-4 -top-4 h-full w-full rounded-[2rem] border-2 border-brand/30" aria-hidden="true" />
          <img src={images.about} alt="The Bannu Drive team at work" loading="lazy" onError={hideBroken} className="img-dim relative aspect-[5/4] w-full rounded-[2rem] bg-navy object-cover shadow-2xl shadow-ink/20" />
          <div className="bd-float absolute -bottom-6 right-4 flex items-center gap-3 rounded-2xl bg-surface p-4 shadow-xl ring-1 ring-line sm:right-8">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-white"><MapPin className="h-5 w-5" /></span>
            <div className="leading-tight">
              <p className="font-display text-base font-bold text-fg">Built for Bannu</p>
              <p className="text-xs text-muted">City &amp; Cantt</p>
            </div>
          </div>
        </Reveal>
        <Reveal delay={150}>
          <p className="eyebrow">About Bannu Drive</p>
          <h2 className="h2 mt-4">Moving Bannu Forward, One Ride at a Time.</h2>
          <p className="lead mt-5">
            Bannu Drive is a local transportation platform that connects riders with verified drivers and intercity coaches. We want getting around Bannu to be safe, fairly priced and simple, whether it's a short bike hop through the bazaar or a seat out of town.
          </p>
          <ul className="mt-6 space-y-3">
            {["Verified drivers on every ride", "You offer a fare that works for you", "Designed around Bannu's roads and landmarks"].map((t, i) => (
              <Reveal as="li" key={t} delay={300 + i * 120} className="flex items-center gap-3 text-sm font-medium text-fg">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/15 text-link"><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
                {t}
              </Reveal>
            ))}
          </ul>
          <Link to="/about" className="btn btn-dark group mt-9">Learn More About Us <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></Link>
        </Reveal>
      </div>
    </section>
  );
}

function Why() {
  return (
    <section className="section relative overflow-hidden bg-ink text-white">
      <div aria-hidden="true" className="bd-float absolute -right-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-brand/20 blur-3xl" />
      <div className="container-x relative">
        <Reveal className="max-w-2xl">
          <h2 className="text-3xl font-extrabold sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">Why Choose Bannu Drive?</h2>
          <p className="mt-4 text-base leading-7 text-white/70 sm:text-lg">Local transport that is safe, fairly priced and easy to book, made for people who know Bannu best.</p>
        </Reveal>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl bg-surface/10 ring-1 ring-surface/10 sm:grid-cols-2 lg:grid-cols-3">
          {WHY.map(({ icon: Icon, title, text }, i) => (
            <Reveal key={title} delay={i * 80} className="group bg-ink p-8 transition-colors hover:bg-navy">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/15 text-mint ring-1 ring-brand/30 transition duration-300 group-hover:rotate-6 group-hover:scale-110 group-hover:bg-brand group-hover:text-white">
                <Icon className="h-6 w-6" strokeWidth={1.7} />
              </span>
              <h3 className="mt-6 text-xl font-bold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-white/65">{text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const [ref, seen] = useInView(0.3);
  return (
    <section id="how-it-works" className="section bg-surface">
      <div className="container-x">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="h2">How Bannu Drive Works</h2>
          <p className="lead mt-4">From tap to trip in four simple steps.</p>
        </Reveal>
        <ol ref={ref} className="relative mt-16 grid gap-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {/* connector line draws itself left-to-right */}
          <div aria-hidden="true" className="absolute left-[12.5%] right-[12.5%] top-8 hidden lg:block">
            <div className={`h-0 origin-left border-t-2 border-dashed border-brand/50 transition-transform duration-[1400ms] ease-out motion-reduce:transition-none ${seen ? "scale-x-100" : "scale-x-0"}`} />
          </div>
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} style={{ transitionDelay: `${i * 250}ms` }}
              className={`group relative flex flex-col items-center text-center transition duration-700 ease-out motion-reduce:transition-none ${seen ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"}`}>
              <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-navy text-white shadow-xl shadow-ink/25 ring-8 ring-surface transition duration-300 group-hover:scale-110">
                <Icon className="h-6 w-6 text-mint" />
              </span>
              <span className="mt-5 font-display text-5xl font-extrabold text-link/20">0{i + 1}</span>
              <h3 className="-mt-2 text-lg font-bold text-fg">{title}</h3>
              <p className="mt-2 max-w-[240px] text-sm leading-6 text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---- driver recruitment ---- */
function DriverCTA() {
  return (
    <section className="section bg-surface">
      <div className="container-x">
        <div className="relative grid items-center gap-10 overflow-hidden rounded-[2rem] bg-ink px-6 py-14 text-white sm:px-12 lg:grid-cols-2 lg:py-16">
          <div aria-hidden="true" className="bd-float absolute -right-20 -top-20 h-72 w-72 rounded-full bg-brand/30 blur-3xl" />
          <Reveal className="relative">
            <h2 className="text-3xl font-extrabold sm:text-4xl">Drive With Bannu Drive</h2>
            <p className="mt-4 max-w-md text-white/75">Own a bike, rickshaw or car? Accept the rides that suit you and earn on your own schedule.</p>
            <ul className="mt-6 space-y-3">
              {DRIVER_PERKS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 text-sm font-medium">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/20 text-mint"><Icon className="h-4.5 w-4.5" /></span>
                  {text}
                </li>
              ))}
            </ul>
            <Link to="/contact" className="btn btn-primary bd-shine group relative mt-8 overflow-hidden">
              Become a Driver <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </Link>
          </Reveal>

          {/* Looping route animation: a ride request travelling from pickup to drop-off */}
          <Reveal delay={200} className="relative hidden lg:block" aria-hidden="true">
            <div className="rounded-3xl bg-white/5 p-8 ring-1 ring-white/10 backdrop-blur">
              <div className="flex items-center justify-between text-xs text-white/60">
                <span>Pickup</span><span>Drop-off</span>
              </div>
              <div className="relative mt-3 h-10">
                <div className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-white/25" />
                <span className="absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-mint" />
                <span className="absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-white" />
                <div className="bd-drive absolute inset-x-0 top-0 text-mint"><Bike className="h-8 w-8" /></div>
              </div>
              <div className="mt-6 flex items-center justify-between rounded-2xl bg-white/10 px-4 py-3">
                <div>
                  <p className="text-[11px] text-white/60">Example request (illustration)</p>
                  <p className="text-sm font-semibold">City Center to Cantt</p>
                </div>
                <p className="font-display text-xl font-extrabold text-mint">PKR 150</p>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function TravelBanner() {
  return (
    <section className="relative isolate flex min-h-[540px] items-center overflow-hidden bg-ink text-white sm:min-h-[620px]">
      <img src={images.travel} alt="Road trip through open country" loading="lazy" onError={hideBroken} className="img-dim bd-drift absolute inset-0 -z-20 h-full w-full object-cover" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ink/90 via-ink/55 to-ink/10" />
      <div className="container-x py-24">
        <Reveal className="max-w-xl">
          <h2 className="text-4xl font-extrabold leading-tight sm:text-5xl lg:text-6xl">Explore Bannu With Bannu Drive</h2>
          <p className="mt-5 text-lg text-white/85">Reliable transportation designed around the way Bannu moves.</p>
          <div className="mt-6 flex flex-wrap gap-2">
            {["City Center", "Cantt", "Chowk Bazaar", "Miranshah Road"].map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5 rounded-full border border-surface/25 bg-surface/10 px-3.5 py-1.5 text-xs font-medium backdrop-blur transition hover:-translate-y-0.5 hover:bg-surface/20">
                <MapPin className="h-3.5 w-3.5 text-mint" />{p}
              </span>
            ))}
          </div>
          <Link to={BOOK_ROUTE} className="btn btn-primary group mt-9">Book Your Ride <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></Link>
        </Reveal>
      </div>
    </section>
  );
}

/* ---- FAQ accordion (smooth height via grid-rows trick) ---- */
function FAQ() {
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" className="section bg-surface">
      <div className="container-x">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="h2">Questions, Answered</h2>
          <p className="lead mt-4">Quick answers before your first ride.</p>
        </Reveal>
        <div className="mx-auto mt-12 max-w-3xl divide-y divide-line overflow-hidden rounded-3xl bg-surface ring-1 ring-line">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q}>
                <button type="button" aria-expanded={isOpen} aria-controls={`faq-${i}`} onClick={() => setOpen(isOpen ? -1 : i)}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition hover:bg-surface-2">
                  <span className="text-base font-bold text-fg">{f.q}</span>
                  <ChevronDown className={`h-5 w-5 flex-shrink-0 text-link transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} />
                </button>
                <div id={`faq-${i}`} role="region" className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                  <div className="overflow-hidden">
                    <p className="px-6 pb-5 text-sm leading-7 text-muted">{f.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="section bg-bg">
      <div className="container-x">
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-navy via-ink to-navy px-6 py-16 text-center text-white sm:px-12 sm:py-20">
            <div aria-hidden="true" className="bd-float absolute -left-20 -top-20 h-72 w-72 rounded-full bg-brand/30 blur-3xl" />
            <div aria-hidden="true" className="bd-float absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-mint/20 blur-3xl" style={{ animationDelay: "1.5s" }} />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-3xl font-extrabold sm:text-4xl lg:text-5xl">Ready to Move Around Bannu?</h2>
              <p className="mx-auto mt-5 max-w-xl text-base text-white/75 sm:text-lg">Your next journey is just a few clicks away.</p>
              <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
                <Link to={BOOK_ROUTE} className="btn btn-primary group">Book a Ride <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></Link>
                <Link to="/contact" className="btn btn-glass">Contact Us</Link>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================== PAGE ============================== */

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-surface">
      <AnimationStyles />
      <Navbar />
      <ScrollProgress />
      <main>
        <Hero />
        {/* Floating booking panel overlaps the bottom of the hero */}
        <div className="container-x relative z-10 -mt-32 sm:-mt-36">
          <BookingPanel />
        </div>
        <Trust />
        <PlacesMarquee items={LOCAL_PLACES} />
        <Rides />
        <IntercitySection video={HERO_VIDEO} />
        <AboutPreview />
        <Why />
        <HowItWorks />
        <DriverCTA />
        <TravelBanner />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
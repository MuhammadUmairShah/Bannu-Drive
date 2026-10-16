import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bike, Car, Bus, ArrowRight, Check, ShieldCheck, Wallet, Clock, Headphones, MapPin, Info } from "lucide-react";
import Navbar, { BOOK_ROUTE } from "./Navbar";
import Footer from "./Footer";
import { RickshawIcon } from "./Logo";
import { images, hideBroken } from "./images";

const SERVICES = [
  {
    id: "bike", icon: Bike, image: images.bike, title: "Bike Ride", tag: "Fast & Affordable",
    text: "The quickest way through bazaar traffic. Ideal for solo trips, errands and short hops across the city.",
    points: ["Beats traffic on busy roads", "Best for one rider", "Lowest starting fare"], cta: "Book a Bike",
  },
  {
    id: "rickshaw", icon: RickshawIcon, image: images.rickshaw, title: "Rickshaw Ride", tag: "Local & Comfortable",
    text: "Easy, open-air rides around the city for you and a friend or two. A familiar way to travel in Bannu.",
    points: ["Room for a small group", "Great for market trips", "Everyday local favourite"], cta: "Book a Rickshaw",
  },
  {
    id: "car", icon: Car, image: images.car, title: "Car Ride", tag: "Comfortable & Reliable",
    text: "Private and comfortable for families, groceries and longer city trips, in any weather.",
    points: ["Space for family and luggage", "Weather-protected", "Ideal for longer city trips"], cta: "Book a Car",
  },
  {
    id: "bus", icon: Bus, image: images.bus, title: "Bus / Coach Tickets", tag: "Long Distance Travel",
    text: "Reserve a seat on intercity coaches and travel beyond Bannu with your ticket sorted in advance.",
    points: ["Choose your date and route", "Seat reserved before you travel", "Trips published by verified operators"], cta: "Book a Ticket",
  },
];

const BENEFITS = [
  { icon: ShieldCheck, title: "Verified drivers", text: "Drivers are checked before they accept rides." },
  { icon: Wallet, title: "You set the offer", text: "Propose a fare that works for you and agree it up front." },
  { icon: Clock, title: "Book in minutes", text: "Pick a ride, set your route and confirm." },
  { icon: Headphones, title: "Help when needed", text: "Our support team is available around the clock." },
];

function ServiceBlock({ s, flip }) {
  const navigate = useNavigate();
  const Icon = s.icon;
  return (
    <article id={s.id} className="scroll-mt-28 grid items-center gap-10 lg:grid-cols-2 lg:gap-20">
      <div className={`relative ${flip ? "lg:order-2" : ""}`}>
        <img src={s.image} alt={s.title} loading="lazy" onError={hideBroken} className="img-dim aspect-[4/3] w-full rounded-[2rem] bg-navy object-cover shadow-2xl shadow-ink/15" />
        <span className="absolute left-5 top-5 inline-flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-sm font-bold text-navy shadow-lg backdrop-blur">
          <Icon className="h-4 w-4 text-link" />{s.tag}
        </span>
      </div>
      <div>
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-link ring-1 ring-brand/20"><Icon className="h-7 w-7" /></span>
        <h2 className="h2 mt-5">{s.title}</h2>
        <p className="lead mt-4">{s.text}</p>
        <ul className="mt-6 space-y-3">
          {s.points.map((p) => (
            <li key={p} className="flex items-center gap-3 text-sm font-medium text-fg">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-white"><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>{p}
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
          <button type="button" onClick={() => navigate(BOOK_ROUTE, { state: { service: s.id } })} className="btn btn-primary">{s.cta}<ArrowRight className="h-4 w-4" /></button>
        </div>
      </div>
    </article>
  );
}

export default function ServicesPage() {
  const { hash } = useLocation();
  // Footer links like /services#car scroll to the matching block
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }, [hash]);

  return (
    <div className="min-h-screen overflow-x-hidden bg-surface">
      <Navbar />
      <main>
        {/* Hero */}
        <section className="relative isolate overflow-hidden bg-ink text-white">
          <img src={images.servicesHero} alt="" onError={hideBroken} className="img-dim absolute inset-0 -z-20 h-full w-full object-cover" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ink/95 via-ink/75 to-ink/30" />
          <div className="container-x py-24 sm:py-32 lg:py-36">
            <p className="eyebrow !text-mint before:!bg-mint">Our Services</p>
            <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.05] sm:text-6xl">A ride for every journey in Bannu.</h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-white/80 sm:text-lg">Bikes, rickshaws and cars for getting around town, and coach tickets for travelling beyond it.</p>
            <div className="mt-8 flex flex-wrap gap-2.5">
              {[["Bike", "#bike"], ["Rickshaw", "#rickshaw"], ["Car", "#car"], ["Bus / Coach", "#bus"]].map(([l, h]) => (
                <a key={l} href={h} className="rounded-full border border-surface/25 bg-surface/10 px-5 py-2.5 text-sm font-semibold backdrop-blur transition hover:bg-brand hover:border-brand">{l}</a>
              ))}
            </div>
          </div>
        </section>

        {/* Service blocks */}
        <section className="section">
          <div className="container-x space-y-24 lg:space-y-32">
            {SERVICES.map((s, i) => <ServiceBlock key={s.id} s={s} flip={i % 2 === 1} />)}
          </div>
        </section>

        {/* Pricing */}
        <section className="section bg-bg">
          <div className="container-x">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="h2">Simple starting fares</h2>
              <p className="lead mt-4">Know what a ride starts at before you book.</p>
            </div>
            <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {SERVICES.map((s, i) => {
                const Icon = s.icon;
                const featured = i === 2;
                return (
                  <div key={s.id} className={`flex flex-col rounded-3xl p-7 ${featured ? "bg-navy text-white shadow-2xl shadow-ink/30 lg:-translate-y-3" : "bg-surface text-fg shadow-lg shadow-ink/5 ring-1 ring-line"}`}>
                    <Icon className={`h-8 w-8 ${featured ? "text-mint" : "text-link"}`} />
                    <h3 className="mt-5 text-lg font-bold">{s.title}</h3>
                    <p className={`mt-2 text-sm ${featured ? "text-white/60" : "text-muted"}`}>{s.id === "bus" ? "Fare set by each operator" : "You offer your fare, drivers respond"}</p>
                    <Link to={BOOK_ROUTE} state={{ service: s.id }} className={`btn mt-7 w-full ${featured ? "btn-primary" : "btn-outline"}`}>{s.id === "bus" ? "Book Ticket" : "Book Now"}</Link>
                  </div>
                );
              })}
            </div>
            <p className="mx-auto mt-10 flex max-w-2xl items-start gap-3 rounded-2xl bg-surface p-4 text-sm text-muted ring-1 ring-line">
              <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-link" />
              For local rides you offer your own fare and drivers respond with offers. Coach fares are set by each operator for each trip and shown before you book.
            </p>
          </div>
        </section>

        {/* Benefits */}
        <section className="section">
          <div className="container-x">
            <div className="max-w-2xl">
              <h2 className="h2">What you get with every booking</h2>
              <p className="lead mt-4">The same simple, dependable experience whichever way you travel.</p>
            </div>
            <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {BENEFITS.map(({ icon: Icon, title, text }) => (
                <div key={title} className="border-t-2 border-brand pt-6">
                  <Icon className="h-7 w-7 text-link" strokeWidth={1.6} />
                  <h3 className="mt-4 text-lg font-bold text-fg">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="container-x pb-20 sm:pb-24">
          <div className="flex flex-col items-start justify-between gap-8 rounded-[2rem] bg-gradient-to-br from-brand to-brand-deep p-8 text-white sm:p-12 lg:flex-row lg:items-center">
            <div>
              <h2 className="text-3xl font-extrabold sm:text-4xl">Ready to book your ride?</h2>
              <p className="mt-3 flex items-center gap-2 text-white/85"><MapPin className="h-5 w-5" />Anywhere in Bannu City and Cantt.</p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link to={BOOK_ROUTE} className="btn bg-white text-navy hover:bg-mist">Book a Ride</Link>
              <Link to="/contact" className="btn btn-glass">Talk to Us</Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

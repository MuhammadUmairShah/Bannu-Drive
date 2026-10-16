import { Link } from "react-router-dom";
import {
  Target, Eye, ShieldCheck, Heart, Users, Scale, Lightbulb, MapPin, ArrowRight, Check,
  Camera, BadgeCheck, Headphones, Navigation,
} from "lucide-react";
import Navbar, { BOOK_ROUTE } from "./Navbar";
import Footer from "./Footer";
import { RickshawIcon } from "./Logo";
import { images, hideBroken } from "./images";
import { Reveal, CountUp, useInView, AnimationStyles } from "./Motion";

/* ============================== DATA ============================== */

const VALUES = [
  { icon: ShieldCheck, title: "Safety first", text: "Every ride starts with a verified driver and a clear agreement." },
  { icon: Scale, title: "Fair pricing", text: "Fares are agreed up front, so nobody is surprised at the end." },
  { icon: Heart, title: "Respect", text: "For riders, for drivers and for the city we serve." },
  { icon: Lightbulb, title: "Simplicity", text: "Booking should take a few taps, not a phone call and a negotiation." },
];

const SAFETY = [
  "Drivers are verified before they can accept rides",
  "Fares are agreed before the trip begins",
  "Support is available around the clock",
  "Trips are booked through the platform, so details are on record",
];

const ROADMAP = [
  { stage: "Today", title: "Bannu City & Cantt", text: "Bike, rickshaw and car rides, plus coach ticket booking." },
  { stage: "Next", title: "More routes and options", text: "Broader coverage across the city and more intercity routes." },
  { stage: "Later", title: "Beyond Bannu", text: "Bringing the same service to nearby towns and districts." },
];

/* Placeholder figures: replace with real numbers. */
const STATS = [
  { value: 5000, suffix: "+", label: "Riders served" },
  { value: 300, suffix: "+", label: "Verified drivers" },
  { value: 40, suffix: "+", label: "Areas covered" },
  { value: 24, suffix: "/7", label: "Support" },
];

/**
 * BANNU PHOTOS: linked from Wikimedia Commons (Category:Bannu).
 * Special:FilePath always resolves to the current image file, so the link
 * doesn't break if the file is re-uploaded. `file` is the exact Commons name.
 * To use your own photos instead, set `src: "/bannu/your-photo.jpg"`.
 * `span` controls the bento layout on large screens.
 */
const commons = (file, w = 1200) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${w}`;

const GALLERY = [
  { src: commons("A street scene in Bannu Pakistan.jpg"), title: "Bannu Street Scene", caption: "Everyday traffic in the heart of the city.", span: "lg:col-span-2 lg:row-span-2" },
  { src: commons("Bannu Fort.jpg"), title: "Bannu Fort", caption: "A landmark at the centre of old Bannu.", span: "" },
  { src: commons("Meryan Gate of Bannu, Pakistan.jpg"), title: "Meryan Gate", caption: "One of the city's historic gates.", span: "" },
  { src: commons("Bannu Kuram River.jpg"), title: "Kurram River", caption: "The river that runs beside Bannu.", span: "" },
  { src: commons("In the city of Bannu.jpg"), title: "In the City", caption: "Local life on Bannu's roads.", span: "lg:col-span-2" },
];

const PROMISES = [
  { icon: BadgeCheck, title: "Verified", text: "Every driver checked" },
  { icon: Navigation, title: "Local", text: "Built on Bannu's roads" },
  { icon: Headphones, title: "Supported", text: "Help day and night" },
];

/* ============================ SECTIONS ============================ */

function AboutHero() {
  return (
    <section className="relative isolate overflow-hidden bg-ink text-white">
      <img src={images.aboutHero} alt="" onError={hideBroken} className="img-dim bd-drift absolute inset-0 -z-20 h-full w-full object-cover" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-ink via-ink/70 to-ink/40" />

      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-6 -z-10 hidden h-10 overflow-hidden opacity-60 lg:block">
        <div className="bd-drive absolute bottom-0 left-0 text-mint"><RickshawIcon className="h-8 w-8" /></div>
        <div className="absolute inset-x-0 bottom-0 border-t-2 border-dashed border-white/20" />
      </div>

      <div className="container-x flex min-h-[460px] flex-col justify-end pb-16 pt-28 sm:min-h-[540px] sm:pb-20">
        <p className="bd-rise eyebrow !text-mint before:!bg-mint">About Bannu Drive</p>
        <h1 className="bd-rise mt-5 max-w-4xl text-4xl font-extrabold leading-[1.05] sm:text-6xl lg:text-7xl" style={{ animationDelay: "150ms" }}>
          Transport that belongs to Bannu.
        </h1>
        <p className="bd-rise mt-6 max-w-xl text-base leading-7 text-white/80 sm:text-lg" style={{ animationDelay: "320ms" }}>
          We're building the ride platform our city has been missing: simple, safe and fairly priced.
        </p>
        <div className="bd-rise mt-8 flex flex-wrap gap-3" style={{ animationDelay: "480ms" }}>
          {PROMISES.map(({ icon: Icon, title, text }) => (
            <span key={title} className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/10 py-2 pl-2 pr-4 text-xs backdrop-blur">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-white"><Icon className="h-3.5 w-3.5" /></span>
              <span><b className="font-bold">{title}</b> <span className="text-white/70">{text}</span></span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Story() {
  return (
    <section className="section">
      <div className="container-x grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
        <Reveal>
          <h2 className="h2">Our story</h2>
          <div className="lead mt-6 space-y-5">
            <p>Getting around Bannu has long meant flagging down whatever passes, bargaining on the roadside and hoping for the best. Booking a coach seat meant a trip to the stand.</p>
            <p>Bannu Drive started with a simple idea: bring bikes, rickshaws, cars and intercity coaches onto one platform, with verified drivers and fares both sides agree on before the trip begins.</p>
            <p>We're a local product, designed around local roads and the way people here actually travel.</p>
          </div>
        </Reveal>
        <Reveal delay={150} className="relative">
          <img src={images.story} alt="Two people shaking hands" loading="lazy" onError={hideBroken} className="img-dim aspect-[4/5] w-full rounded-[2rem] bg-navy object-cover shadow-2xl shadow-ink/20" />
          <div className="bd-float absolute -bottom-5 -left-3 rounded-2xl bg-brand px-5 py-4 text-white shadow-xl sm:-left-6">
            <p className="font-display text-lg font-bold leading-tight">Local by design</p>
            <p className="text-sm text-white/85">Built in and for Bannu</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Stats() {
  return (
    <section className="relative overflow-hidden bg-navy py-14 text-white sm:py-16">
      <div aria-hidden="true" className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand/25 blur-3xl" />
      <div className="container-x relative grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4 lg:divide-x lg:divide-white/10">
        {STATS.map(({ value, suffix, label }, i) => (
          <Reveal key={label} delay={i * 100} className="text-center">
            <p className="font-display text-4xl font-extrabold sm:text-5xl"><CountUp value={value} suffix={suffix} /></p>
            <p className="mt-1 text-sm text-white/70">{label}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function MissionVision() {
  const items = [
    { icon: Target, label: "Our mission", text: "To make safe, affordable and convenient transportation available to everyone in Bannu, one ride at a time.", dark: true },
    { icon: Eye, label: "Our vision", text: "A Bannu where every journey, across the street or across the country, is a few taps away and a driver you can trust.", dark: false },
  ];
  return (
    <section className="section bg-bg">
      <div className="container-x grid gap-6 lg:grid-cols-2">
        {items.map(({ icon: Icon, label, text, dark }, i) => (
          <Reveal key={label} delay={i * 150}>
            <div className={`group h-full rounded-[2rem] p-8 transition duration-300 hover:-translate-y-1 sm:p-12 ${dark ? "bg-navy text-white" : "bg-surface text-fg ring-1 ring-line"}`}>
              <span className={`flex h-14 w-14 items-center justify-center rounded-2xl transition duration-300 group-hover:rotate-6 group-hover:scale-110 ${dark ? "bg-brand text-white" : "bg-brand/10 text-link"}`}><Icon className="h-7 w-7" /></span>
              <h2 className="mt-6 text-2xl font-extrabold sm:text-3xl">{label}</h2>
              <p className={`mt-4 text-lg leading-8 ${dark ? "text-white/75" : "text-muted"}`}>{text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Values() {
  return (
    <section className="section">
      <div className="container-x">
        <Reveal className="max-w-2xl">
          <h2 className="h2">What we stand for</h2>
          <p className="lead mt-4">Four principles guide every decision we make.</p>
        </Reveal>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {VALUES.map(({ icon: Icon, title, text }, i) => (
            <Reveal key={title} delay={i * 100} className="h-full">
              <div className="group h-full rounded-3xl bg-surface p-7 shadow-lg shadow-ink/5 ring-1 ring-line transition duration-300 hover:-translate-y-1.5 hover:ring-brand/40">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-link transition duration-300 group-hover:rotate-6 group-hover:scale-110 group-hover:bg-brand group-hover:text-white"><Icon className="h-6 w-6" /></span>
                <h3 className="mt-5 text-lg font-bold text-fg">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---- NEW: photo gallery of real Bannu places ---- */
function GalleryTile({ g, delay }) {
  return (
    <Reveal delay={delay} className={g.span}>
    <figure className="group relative h-full min-h-[220px] overflow-hidden rounded-3xl bg-navy">
      {/* Placeholder shown until you add the photo */}
      <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-navy to-ink text-white/20">
        <Camera className="h-10 w-10" strokeWidth={1.2} />
      </div>
      <img src={g.src} alt={`${g.title}, Bannu`} loading="lazy" onError={hideBroken} className="img-dim absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105" />
      <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/10 to-transparent" />
      <figcaption className="absolute inset-x-0 bottom-0 p-5 text-white">
        <p className="flex items-center gap-1.5 font-display text-lg font-bold"><MapPin className="h-4 w-4 text-mint" />{g.title}</p>
        <p className="mt-1 max-h-0 overflow-hidden text-sm text-white/80 opacity-0 transition-all duration-500 group-hover:max-h-20 group-hover:opacity-100">{g.caption}</p>
      </figcaption>
    </figure>
    </Reveal>
  );
}

function Gallery() {
  return (
    <section className="section bg-bg">
      <div className="container-x">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="h2">Bannu, as it looks</h2>
          <p className="lead mt-4">The streets, gates and river that Bannu Drive is built around.</p>
        </Reveal>
        <div className="mt-12 grid auto-rows-[220px] gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {GALLERY.map((g, i) => (
            <GalleryTile key={g.title} g={g} delay={i * 90} />
          ))}
        </div>
        <p className="mt-4 text-center text-xs text-muted">
          Photos via{" "}
          <a href="https://commons.wikimedia.org/wiki/Category:Bannu" target="_blank" rel="noopener noreferrer" className="underline hover:text-fg">Wikimedia Commons</a>
          {" "}(licence and author shown on each file's page).
        </p>
      </div>
    </section>
  );
}

function Safety() {
  return (
    <section className="section bg-ink text-white">
      <div className="container-x grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <Reveal>
          <img src={images.safety} alt="Reviewing documents" loading="lazy" onError={hideBroken} className="img-dim aspect-[4/3] w-full rounded-[2rem] bg-navy object-cover opacity-90" />
        </Reveal>
        <Reveal delay={150}>
          <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/20 text-mint ring-1 ring-brand/40">
            <span className="bd-ping absolute inset-0 rounded-2xl ring-2 ring-brand/50" />
            <ShieldCheck className="h-7 w-7" />
          </span>
          <h2 className="mt-6 text-3xl font-extrabold sm:text-4xl">Safety is the starting point</h2>
          <p className="mt-4 text-base leading-7 text-white/70 sm:text-lg">Trust is what makes a ride platform work, so we build around it from the first booking.</p>
          <ul className="mt-8 space-y-4">
            {SAFETY.map((t, i) => (
              <Reveal as="li" key={t} delay={300 + i * 120} className="flex items-start gap-3 text-white/90">
                <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand text-white"><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>{t}
              </Reveal>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

function Local() {
  return (
    <section className="section">
      <div className="container-x">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <Reveal>
            <h2 className="h2">Rooted in Bannu</h2>
            <p className="lead mt-5">We know the bazaar lanes, the Cantt roads and the routes out of town. That local knowledge shapes the places we suggest, the fares we start from and the support we give.</p>
          </Reveal>
          <div className="flex flex-wrap content-start gap-3">
            {["Bannu City Center", "Bannu Cantt", "Chowk Bazaar", "Miranshah Road", "UST Bannu Main Campus", "DHQ Hospital"].map((p, i) => (
              <Reveal key={p} delay={i * 80}>
                <span className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-5 py-3 text-sm font-semibold text-fg ring-1 ring-line transition duration-300 hover:-translate-y-1 hover:bg-brand hover:text-white">
                  <MapPin className="h-4 w-4 text-link" />{p}
                </span>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Roadmap() {
  const [ref, seen] = useInView(0.3);
  return (
    <section className="section bg-bg">
      <div className="container-x">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="h2">Where we're headed</h2>
          <p className="lead mt-4">We're starting in Bannu and growing carefully from here.</p>
        </Reveal>
        <div ref={ref} className="relative mt-14 grid gap-6 md:grid-cols-3">
          {ROADMAP.map((r, i) => (
            <div key={r.stage} style={{ transitionDelay: `${i * 250}ms` }}
              className={`relative rounded-3xl bg-surface p-8 ring-1 ring-line transition duration-700 ease-out motion-reduce:transition-none ${seen ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"}`}>
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${i === 0 ? "bg-brand text-white" : "bg-surface-3 text-fg"}`}>{r.stage}</span>
              <h3 className="mt-5 text-xl font-bold text-fg">{r.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{r.text}</p>
              {i < 2 && <ArrowRight className="absolute -right-5 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 rounded-full bg-surface p-2.5 text-link shadow-md md:block" />}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="section">
      <Reveal className="container-x text-center">
        <Users className="bd-float mx-auto h-10 w-10 text-link" strokeWidth={1.5} />
        <h2 className="h2 mx-auto mt-5 max-w-2xl">Be part of Bannu's next chapter.</h2>
        <p className="lead mx-auto mt-4 max-w-xl">Ride with us, drive with us or tell us what Bannu needs.</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link to={BOOK_ROUTE} className="btn btn-primary group">Book a Ride <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></Link>
          <Link to="/contact" className="btn btn-outline">Contact Us</Link>
        </div>
      </Reveal>
    </section>
  );
}

/* ============================== PAGE ============================== */

export default function AboutPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-surface">
      <AnimationStyles />
      <Navbar />
      <main>
        <AboutHero />
        <Story />
        <Stats />
        <MissionVision />
        <Values />
        <Gallery />
        <Safety />
        <Local />
        <Roadmap />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
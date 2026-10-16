import { useState } from "react";
import { Link } from "react-router-dom";
import { Phone, Mail, MapPin, Send, Clock, CheckCircle2, Headphones, ArrowRight } from "lucide-react";
import Navbar, { BOOK_ROUTE } from "./Navbar";
import Footer from "./Footer";
import { images, hideBroken } from "./images";

/* TODO: replace these placeholders with your real contact details */
const CONTACT = {
  phone: "+92 300 0000000",
  email: "support@bannudrive.com",
  location: "Bannu City, Khyber Pakhtunkhwa, Pakistan",
  hours: "Support available 24/7",
};

const SOCIALS = [
  { label: "Facebook", href: "https://facebook.com/" },
  { label: "Instagram", href: "https://instagram.com/" },
  { label: "WhatsApp", href: "https://wa.me/" },
  { label: "X", href: "https://x.com/" },
];

const CARDS = [
  { icon: Phone, label: "Call us", value: CONTACT.phone, href: `tel:${CONTACT.phone.replace(/\s/g, "")}` },
  { icon: Mail, label: "Email us", value: CONTACT.email, href: `mailto:${CONTACT.email}` },
  { icon: MapPin, label: "Find us", value: CONTACT.location },
];

/* Stylised map: roads, a river-like curve and a pin. Illustrative only. */
function MapVisual() {
  return (
    <div className="relative h-full min-h-[320px] overflow-hidden rounded-3xl bg-surface-2 ring-1 ring-line">
      <svg viewBox="0 0 600 420" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <pattern id="bd-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" className="stroke-line" /></pattern>
        </defs>
        <rect width="600" height="420" fill="url(#bd-grid)" />
        <path d="M-10 300C120 260 200 340 330 300S520 230 620 270" className="stroke-primary-soft" strokeWidth="26" fill="none" />
        <path d="M0 120H600M120 0V420M440 0V420M0 360H600" className="stroke-surface" strokeWidth="14" />
        <path d="M-10 190C150 150 300 230 460 160S580 110 620 130" className="stroke-surface" strokeWidth="18" fill="none" />
        <path d="M-10 190C150 150 300 230 460 160S580 110 620 130" className="bd-dash stroke-primary" strokeWidth="3" strokeDasharray="10 12" fill="none" />
        <rect x="140" y="140" width="80" height="60" rx="10" className="fill-surface-3" /><rect x="470" y="190" width="90" height="80" rx="10" className="fill-surface-3" />
        <rect x="20" y="30" width="80" height="60" rx="10" className="fill-surface-3" /><rect x="460" y="20" width="100" height="70" rx="10" className="fill-surface-3" />
      </svg>
      <div className="absolute left-[46%] top-[40%] -translate-x-1/2 -translate-y-full">
        <div className="relative flex flex-col items-center">
          <span className="absolute -bottom-1 h-3 w-8 rounded-full bg-black/20 blur-sm" />
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-xl ring-4 ring-surface"><MapPin className="h-6 w-6" /></span>
          <span className="mt-1 h-3 w-1 rounded-full bg-brand" />
        </div>
      </div>
      <div className="absolute bottom-4 left-4 right-4 rounded-2xl bg-white/95 p-4 shadow-lg backdrop-blur sm:right-auto sm:max-w-xs">
        <p className="font-display text-base font-bold text-fg">Bannu Drive</p>
        <p className="text-sm text-muted">{CONTACT.location}</p>
      </div>
    </div>
  );
}

function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", subject: "General question", message: "" });
  const [sent, setSent] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    // UI-only for now: connect this to your backend or email service.
    setSent(true);
  };

  if (sent) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-3xl bg-surface p-10 text-center shadow-xl ring-1 ring-line" role="status">
        <CheckCircle2 className="h-14 w-14 text-link" />
        <h3 className="mt-5 text-2xl font-extrabold text-fg">Message sent</h3>
        <p className="mt-2 max-w-sm text-muted">Thanks, {form.name || "friend"}. We'll reply to {form.email || "your email"} as soon as we can.</p>
        <button type="button" onClick={() => { setSent(false); setForm({ name: "", email: "", subject: "General question", message: "" }); }} className="btn btn-outline mt-7">Send another message</button>
      </div>
    );
  }

  const field = "w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-fg outline-none transition placeholder:text-subtle focus:border-brand focus:bg-surface focus:ring-2 focus:ring-brand/20";
  return (
    <form onSubmit={submit} className="rounded-3xl bg-surface p-6 shadow-xl shadow-ink/10 ring-1 ring-line sm:p-9">
      <h2 className="text-2xl font-extrabold text-fg">Send us a message</h2>
      <p className="mt-1 text-sm text-muted">We usually reply the same day.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold text-fg">Full name
          <input required value={form.name} onChange={set("name")} placeholder="Your name" className={`${field} mt-1.5 font-normal`} />
        </label>
        <label className="text-sm font-semibold text-fg">Email
          <input required type="email" value={form.email} onChange={set("email")} placeholder="you@example.com" className={`${field} mt-1.5 font-normal`} />
        </label>
        <label className="text-sm font-semibold text-fg sm:col-span-2">Topic
          <select value={form.subject} onChange={set("subject")} className={`${field} mt-1.5 font-normal`}>
            {["General question", "Ride or booking help", "Coach tickets", "Become a driver", "Feedback"].map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-fg sm:col-span-2">Message
          <textarea required rows={5} value={form.message} onChange={set("message")} placeholder="How can we help?" className={`${field} mt-1.5 resize-none font-normal`} />
        </label>
      </div>
      <button type="submit" className="btn btn-primary mt-6 w-full sm:w-auto"><Send className="h-4 w-4" />Send message</button>
    </form>
  );
}

export default function ContactPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-surface">
      <Navbar />
      <main>
        <section className="relative isolate overflow-hidden bg-ink text-white">
          <img src={images.contactHero} alt="" onError={hideBroken} className="img-dim absolute inset-0 -z-20 h-full w-full object-cover" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ink/95 via-ink/80 to-ink/40" />
          <div className="container-x pb-36 pt-24 sm:pb-40 sm:pt-32">
            <p className="eyebrow !text-mint before:!bg-mint">Contact Us</p>
            <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.05] sm:text-6xl">We're here whenever you need us.</h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-white/80 sm:text-lg">Questions about a ride, a coach ticket or driving with us? Reach out and we'll help.</p>
          </div>
        </section>

        {/* Info cards overlap hero */}
        <div className="container-x relative z-10 -mt-24 grid gap-5 md:grid-cols-3">
          {CARDS.map(({ icon: Icon, label, value, href }) => {
            const body = (
              <>
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/30"><Icon className="h-6 w-6" /></span>
                <p className="mt-5 text-sm font-semibold text-muted">{label}</p>
                <p className="mt-1 break-words font-display text-lg font-bold text-fg">{value}</p>
              </>
            );
            const cls = "block rounded-3xl bg-surface p-7 shadow-[0_20px_50px_-20px_rgba(6,44,44,0.35)] ring-1 ring-line";
            return href ? <a key={label} href={href} className={`${cls} transition hover:-translate-y-1`}>{body}</a> : <div key={label} className={cls}>{body}</div>;
          })}
        </div>

        {/* Form + map */}
        <section className="section">
          <div className="container-x grid gap-8 lg:grid-cols-2">
            <ContactForm />
            <div className="flex flex-col gap-6">
              <MapVisual />
              <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-5 ring-1 ring-line">
                <Clock className="h-6 w-6 text-link" />
                <p className="text-sm font-semibold text-fg">{CONTACT.hours}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Social + support CTA */}
        <section className="container-x pb-20 sm:pb-24">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-[2rem] bg-surface-2 p-8 ring-1 ring-line sm:p-10">
              <h2 className="text-2xl font-extrabold text-fg">Follow Bannu Drive</h2>
              <p className="mt-2 text-muted">News, updates and service announcements.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                {SOCIALS.map((s) => (
                  <a key={s.label} href={s.href} target="_blank" rel="noreferrer" className="rounded-full bg-surface px-5 py-2.5 text-sm font-semibold text-fg ring-1 ring-line transition hover:bg-brand hover:text-white hover:ring-brand">{s.label}</a>
                ))}
              </div>
            </div>
            <div className="flex flex-col justify-between rounded-[2rem] bg-navy p-8 text-white sm:p-10">
              <div>
                <Headphones className="h-8 w-8 text-mint" />
                <h2 className="mt-4 text-2xl font-extrabold">Need help with a trip?</h2>
                <p className="mt-2 text-white/70">Our support team is available around the clock.</p>
              </div>
              <Link to={BOOK_ROUTE} className="btn btn-primary mt-8 self-start">Book a Ride <ArrowRight className="h-4 w-4" /></Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

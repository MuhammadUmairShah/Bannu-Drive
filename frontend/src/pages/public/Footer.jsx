import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import Logo from "./Logo";

const QUICK_LINKS = [
  { label: "Home", to: "/" },
  { label: "Services", to: "/services" },
  { label: "About", to: "/about" },
  { label: "Contact Us", to: "/contact" },
];
const SERVICE_LINKS = [
  { label: "Bike Ride", to: "/services#bike" },
  { label: "Rickshaw Ride", to: "/services#rickshaw" },
  { label: "Car Ride", to: "/services#car" },
  { label: "Bus / Coach Tickets", to: "/services#bus" },
];
// /terms and /privacy are placeholders for pages you can add later.
const SUPPORT_LINKS = [
  { label: "Help Center", to: "/contact" },
  { label: "Contact Us", to: "/contact" },
  { label: "Terms & Conditions", to: "/terms" },
  { label: "Privacy Policy", to: "/privacy" },
];

// TODO: replace the hrefs with your real social profiles / WhatsApp number
const iconProps = { viewBox: "0 0 24 24", className: "h-[18px] w-[18px]", "aria-hidden": true };
const SOCIALS = [
  {
    label: "Facebook",
    href: "https://facebook.com/",
    icon: (
      <svg {...iconProps} fill="currentColor">
        <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z" />
      </svg>
    ),
  },
  {
    label: "Instagram",
    href: "https://instagram.com/",
    icon: (
      <svg {...iconProps} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="0.8" fill="currentColor" />
      </svg>
    ),
  },
  {
    label: "WhatsApp",
    href: "https://wa.me/",
    icon: (
      <svg {...iconProps} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21" />
        <path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1" />
      </svg>
    ),
  },
  {
    label: "X (Twitter)",
    href: "https://x.com/",
    icon: (
      <svg {...iconProps} fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
];

function LinkColumn({ title, links }) {
  return (
    <div>
      <h3 className="font-sans text-sm font-bold tracking-normal text-white">{title}</h3>
      <ul className="mt-5 space-y-3">
        {links.map(({ label, to }) => (
          <li key={label}>
            <Link to={to} className="text-sm text-white/60 transition hover:text-mint">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-white/5 bg-ink text-white">
      {/* road line along the top edge */}
      <div aria-hidden="true" className="h-1 w-full bg-[repeating-linear-gradient(90deg,#00A86B_0_28px,transparent_28px_44px)]" />
      <div className="mx-auto max-w-7xl px-5 pb-8 pt-14 sm:px-6 lg:px-8 lg:pt-20">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr] lg:gap-12">
          <div>
            <Logo showTagline />
            <p className="mt-5 max-w-xs text-sm leading-6 text-white/60">
              Safe, affordable and convenient transportation for Bannu City and beyond.
            </p>
            <div className="mt-7 flex gap-2.5">
              {SOCIALS.map(({ label, href, icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={label}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-surface/5 text-white/75 ring-1 ring-surface/10 transition hover:bg-brand hover:text-white hover:ring-brand"
                >
                  {icon}
                </a>
              ))}
            </div>
          </div>
          <LinkColumn title="Quick Links" links={QUICK_LINKS} />
          <LinkColumn title="Services" links={SERVICE_LINKS} />
          <LinkColumn title="Support" links={SUPPORT_LINKS} />
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-surface/10 pt-6 text-sm text-white/50 sm:flex-row">
          <p>© 2026 Bannu Drive. All rights reserved.</p>
          <Link to="/login" className="inline-flex items-center gap-1 font-medium text-white/70 transition hover:text-mint">
            Driver &amp; customer login <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </footer>
  );
}

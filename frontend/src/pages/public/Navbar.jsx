import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Menu, X, ArrowRight } from "lucide-react";
import Logo from "./Logo";
import ThemeToggle from "../../components/ThemeToggle";
import { useAuth } from "../../context/AuthContext";

/* Navigation config – edit routes here. */
export const NAV_LINKS = [
  { label: "Home", to: "/", end: true },
  { label: "Services", to: "/services" },
  { label: "About", to: "/about" },
  { label: "Bus & Coaches", to: "/coaches" },
  { label: "Contact Us", to: "/contact" },
];
export const BOOK_ROUTE = "/login";
const HOME_OF = { customer: "/customer", driver: "/driver", operator: "/operator", admin: "/admin" };

export default function Navbar() {
  const { pathname } = useLocation();
  const { user } = useAuth() || {};
  const accountTo = user ? HOME_OF[user.role] || "/" : BOOK_ROUTE;
  const isHome = pathname === "/";
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  // Transparent glass only while sitting on top of the home hero
  const glass = isHome && !scrolled && !open;

  return (
    <header
  className={`fixed inset-x-0 top-0 z-50 border-b transition-all duration-300 ${
    glass
      ? "border-surface/10 bg-gradient-to-b from-ink/60 to-ink/10 backdrop-blur-[6px]"
      : "border-surface/5 bg-navy/95 shadow-lg shadow-black/15 backdrop-blur-md"
  }`}
>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-6 lg:h-[68px] lg:px-8">
        <Logo />

        <nav aria-label="Main" className="hidden items-center gap-9 md:flex">
          {NAV_LINKS.map(({ label, to, end }) => (
            <NavLink key={to} to={to} end={end} className="group relative py-2 text-sm font-medium">
              {({ isActive }) => (
                <>
                  <span className={`transition-colors ${isActive ? "text-white" : "text-white/75 group-hover:text-white"}`}>{label}</span>
                  <span
                    className={`absolute inset-x-0 -bottom-0.5 h-0.5 origin-left rounded-full bg-mint transition-transform duration-300 ${
                      isActive ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
                    }`}
                  />
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle variant="onDark" />
          <Link to={accountTo} className="btn btn-primary hidden !px-5 !py-2.5 sm:inline-flex">
            {user ? "My Account" : "Login / Book Now"}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-white transition hover:bg-surface/10 md:hidden"
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      <div id="mobile-menu" className={`grid transition-[grid-template-rows] duration-300 md:hidden ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <nav aria-label="Mobile" className="space-y-1 px-5 pb-5 pt-1 sm:px-6">
            {NAV_LINKS.map(({ label, to, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-3.5 text-base font-medium transition ${
                    isActive ? "bg-brand/15 text-white" : "text-white/80 hover:bg-surface/5 hover:text-white"
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
            <Link to={accountTo} className="btn btn-primary mt-3 w-full !py-3.5 text-base">
              {user ? "My Account" : "Login / Book Now"}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}

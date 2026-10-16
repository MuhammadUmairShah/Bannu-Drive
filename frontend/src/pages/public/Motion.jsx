import { useEffect, useRef, useState } from "react";

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Fires once when the element scrolls into view. */
export function useInView(threshold = 0.2) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen];
}

/** Fade + slide-up on scroll. `delay` (ms) staggers siblings. */
export function Reveal({ children, delay = 0, className = "", as: Tag = "div" }) {
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

/** Counts up from 0 when visible. */
export function CountUp({ value, decimals = 0, suffix = "" }) {
  const [ref, seen] = useInView(0.4);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (prefersReducedMotion()) { setN(value); return; }
    let raf;
    const start = performance.now();
    const tick = (t) => {
      const p = Math.min((t - start) / 1600, 1);
      setN(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, value]);
  return <span ref={ref}>{n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>;
}

/** Shared keyframes. Render once per page. */
export function AnimationStyles() {
  return (
    <style>{`
      @keyframes bd-drive { 0% { transform: translateX(-12%); } 100% { transform: translateX(112%); } }
      @keyframes bd-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
      @keyframes bd-ping  { 0% { transform: scale(.8); opacity: .7; } 100% { transform: scale(2.2); opacity: 0; } }
      .bd-drive { animation: bd-drive 9s linear infinite; }
      .bd-float { animation: bd-float 4s ease-in-out infinite; }
      .bd-ping  { animation: bd-ping 2.2s ease-out infinite; }
      @media (prefers-reduced-motion: reduce) {
        .bd-drive, .bd-float, .bd-ping { animation: none !important; }
      }
    `}</style>
  );
}

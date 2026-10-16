import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Wallet, MapPin } from 'lucide-react';
import Logo from '../pages/public/Logo';
import ThemeToggle from './ThemeToggle';
import { images, hideBroken } from '../pages/public/images';

const POINTS = [
  { icon: ShieldCheck, text: 'Verified drivers on every ride' },
  { icon: Wallet, text: 'Fair, agreed fares — you set your offer' },
  { icon: MapPin, text: 'Built around Bannu City and Cantt' }
];

/**
 * Shared frame for Login / Register / Forgot / Reset password.
 * Split screen on large displays (brand image + reasons to trust us), single column on phones.
 */
export default function AuthShell({ title, subtitle, children, maxWidth = 'max-w-md' }) {
  return (
    <div className="min-h-dvh bg-bg text-fg lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Brand panel */}
      <aside className="relative isolate hidden overflow-hidden bg-ink text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <img src={images.travel} alt="" onError={hideBroken} className="bd-drift absolute inset-0 -z-20 h-full w-full object-cover" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-ink/85 via-ink/55 to-ink/90" />
        <Logo />
        <div className="bd-rise max-w-md">
          <h2 className="text-4xl font-extrabold leading-[1.08] xl:text-5xl">
            Your journey.
            <span className="block text-mint">Your fare. Your choice.</span>
          </h2>
          <ul className="mt-8 space-y-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-white/90">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface/10 text-mint ring-1 ring-surface/15 backdrop-blur">
                  <Icon className="h-5 w-5" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-white/60">© 2026 Bannu Drive</p>
      </aside>

      {/* Form panel */}
      <main className="flex min-h-dvh flex-col px-5 py-6 sm:px-8">
        <div className="flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-1.5 rounded-xl py-2 text-sm font-medium text-muted transition-colors hover:text-fg">
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center py-8">
          <div className={`bd-page w-full ${maxWidth}`}>
            <div className="mb-7 text-center lg:text-left">
              <div className="mb-6 flex justify-center lg:hidden">
                <Logo onDark={false} />
              </div>
              <h1 className="font-display text-3xl font-extrabold text-fg">{title}</h1>
              {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
            </div>
            <div className="card p-6 sm:p-8">{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}

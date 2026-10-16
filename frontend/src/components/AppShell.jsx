import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Menu, Search, X, CornerDownLeft } from 'lucide-react';
import Logo from '../pages/public/Logo';
import Avatar from './Avatar';
import NotificationBell from './NotificationBell';
import ThemeToggle from './ThemeToggle';

/**
 * Shared dashboard shell used by the Admin, Customer, Driver and Operator layouts.
 * Layouts keep ALL their own logic (auth, GPS, online status ...) and only pass data in:
 *
 *   portal        "Admin" | "Customer" | ...      small label next to the logo / in the topbar
 *   navItems      [{ name, path, icon }]
 *   isActive      (item, pathname) => boolean     each layout keeps its own matching rule
 *   user          current user (for the avatar)
 *   profileName / profileSub                      text shown beside the avatar
 *   onLogout      () => void
 *   sidebarTop    optional node above the nav (e.g. the driver online switch)
 *   banners       optional node above the page content
 *   showBell      show the notification bell (default true)
 */
export function Banner({ tone = 'warning', children }) {
  const tones = {
    warning: 'border-warning/30 bg-warning-soft text-warning',
    danger: 'border-danger/30 bg-danger-soft text-danger',
    info: 'border-info/30 bg-info-soft text-info'
  };
  return (
    <div role="status" className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm font-medium ${tones[tone]}`}>
      {children}
    </div>
  );
}

function PageSearch({ navItems, onPick, autoFocus = false }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return navItems.filter((i) => i.name.toLowerCase().includes(term)).slice(0, 6);
  }, [q, navItems]);

  useEffect(() => setCursor(0), [q]);

  // "/" focuses the search from anywhere (unless typing in a field)
  useEffect(() => {
    function onKey(e) {
      const tag = (e.target.tagName || '').toLowerCase();
      if (e.key === '/' && !['input', 'textarea', 'select'].includes(tag) && !e.target.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    function onAway(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onAway);
    return () => document.removeEventListener('mousedown', onAway);
  }, []);

  function pick(item) {
    setQ('');
    setOpen(false);
    inputRef.current?.blur();
    onPick(item.path);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter' && results[cursor]) { e.preventDefault(); pick(results[cursor]); }
    else if (e.key === 'Escape') { setQ(''); setOpen(false); e.currentTarget.blur(); }
  }

  return (
    <div className="relative w-full" ref={wrapRef}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        type="search"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Jump to a page…"
        aria-label="Search pages"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="shell-search-results"
        className="w-full rounded-xl border border-line bg-surface-2 py-2 pl-10 pr-9 text-sm text-fg outline-none transition placeholder:text-subtle focus:border-primary focus:bg-surface focus:ring-2 focus:ring-primary/25 [&::-webkit-search-cancel-button]:hidden"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-line-strong px-1.5 text-[11px] font-semibold text-subtle lg:block">/</kbd>

      {open && q.trim() && (
        <ul id="shell-search-results" role="listbox" className="bd-fade absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-pop">
          {results.length === 0 && <li className="px-3 py-3 text-sm text-muted">No matching pages</li>}
          {results.map((item, i) => {
            const Icon = item.icon;
            return (
              <li key={item.path} role="option" aria-selected={i === cursor}>
                <button
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(item)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-fg transition-colors ${i === cursor ? 'bg-primary-soft' : ''}`}
                >
                  <Icon className="h-4 w-4 text-link" />
                  <span className="flex-1">{item.name}</span>
                  {i === cursor && <CornerDownLeft className="h-3.5 w-3.5 text-subtle" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function AppShell({
  portal,
  navItems,
  isActive,
  user,
  profileName,
  profileSub,
  onLogout,
  sidebarTop = null,
  banners = null,
  showBell = true,
  children
}) {
  const [open, setOpen] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef(null);

  const active = (item) => (isActive ? isActive(item, pathname) : pathname === item.path);
  const current = navItems.find(active);

  // New page -> close drawers and start at the top of the content area
  useEffect(() => {
    setOpen(false);
    setMobileSearch(false);
    mainRef.current?.scrollTo?.({ top: 0 });
  }, [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      {/* Mobile backdrop */}
      {open && <div className="bd-fade fixed inset-0 z-40 bg-scrim backdrop-blur-[2px] lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      {/* Sidebar */}
      <aside
        aria-label={`${portal} navigation`}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar text-sidebar-fg shadow-2xl transition-transform duration-300 ease-out lg:static lg:w-64 lg:max-w-none lg:translate-x-0 lg:shadow-none ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-sidebar-line px-5">
          <Logo />
          <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="rounded-lg p-2 text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-white lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 pb-2 pt-4">
          <span className="inline-flex items-center gap-2 rounded-full bg-sidebar-active px-3 py-1 text-xs font-semibold text-sidebar-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-sidebar-accent" />
            {portal} portal
          </span>
        </div>

        {sidebarTop}

        <nav className="custom-scrollbar flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const on = active(item);
            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={on ? 'page' : undefined}
                className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  on ? 'bg-sidebar-active text-white' : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-white'
                }`}
              >
                <span className={`absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-accent transition-all ${on ? 'opacity-100' : 'h-0 opacity-0'}`} aria-hidden="true" />
                <Icon className={`h-[18px] w-[18px] shrink-0 transition-colors ${on ? 'text-sidebar-accent' : 'group-hover:text-sidebar-accent'}`} />
                <span className="truncate">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-sidebar-line p-3">
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-sidebar-danger transition-colors hover:bg-sidebar-hover"
          >
            <LogOut className="h-[18px] w-[18px]" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-30 shrink-0 border-b border-line bg-surface/85 backdrop-blur-md">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="-ml-2 rounded-lg p-2 text-muted transition-colors hover:bg-surface-2 hover:text-fg lg:hidden">
              <Menu className="h-6 w-6" />
            </button>

            <div className="min-w-0 lg:w-56">
              <p className="hidden text-xs font-medium text-muted sm:block">{portal} portal</p>
              <h1 className="truncate font-display text-base font-bold leading-tight text-fg sm:text-lg">{current?.name || portal}</h1>
            </div>

            <div className="mx-auto hidden w-full max-w-md md:block">
              <PageSearch navItems={navItems} onPick={(path) => navigate(path)} />
            </div>

            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => setMobileSearch((v) => !v)}
                aria-label="Search pages"
                aria-expanded={mobileSearch}
                className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-fg md:hidden"
              >
                <Search className="h-5 w-5" />
              </button>
              <ThemeToggle />
              {showBell && <NotificationBell />}
              <div className="flex items-center gap-3 border-l border-line pl-3 sm:pl-4">
                <Avatar user={user} size="sm" />
                <div className="hidden text-left leading-tight sm:block">
                  <p className="max-w-[10rem] truncate text-sm font-semibold text-fg">{profileName || 'Loading...'}</p>
                  <p className="max-w-[10rem] truncate text-xs text-muted">{profileSub}</p>
                </div>
              </div>
            </div>
          </div>

          {mobileSearch && (
            <div className="bd-fade border-t border-line px-4 pb-3 pt-3 md:hidden">
              <PageSearch navItems={navItems} onPick={(path) => navigate(path)} autoFocus />
            </div>
          )}
        </header>

        <main ref={mainRef} className="custom-scrollbar flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {banners && <div className="mb-5 space-y-3">{banners}</div>}
          <div key={pathname} className="bd-page">
            {children || <Outlet />}
          </div>
        </main>
      </div>
    </div>
  );
}

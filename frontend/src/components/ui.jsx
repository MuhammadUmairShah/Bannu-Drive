import { RefreshCw, AlertCircle, Inbox } from 'lucide-react';

export const PageHeader = ({ title, subtitle, action, icon: Icon }) => (
  <div className="flex flex-wrap items-end justify-between gap-3">
    <div className="flex items-center gap-3">
      {Icon && (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-link ring-1 ring-primary/20">
          <Icon className="h-5 w-5" />
        </span>
      )}

      <div>
        <h1 className="font-display text-2xl font-extrabold leading-tight text-fg">
          {title}
        </h1>

        {subtitle && (
          <p className="mt-0.5 text-sm text-muted">
            {subtitle}
          </p>
        )}
      </div>
    </div>

    {action}
  </div>
);

export const Loading = ({ text = 'Loading...' }) => (
  <div className="py-14 text-center" role="status">
    <RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin text-link" />

    <p className="text-sm text-muted">
      {text}
    </p>
  </div>
);

export const ErrorBox = ({ message, onRetry }) => (
  <div className="space-y-3 p-8 text-center" role="alert">
    <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
      <AlertCircle className="h-6 w-6" />
    </span>

    <p className="text-sm font-medium text-danger">
      {message}
    </p>

    {onRetry && (
      <button
        type="button"
        onClick={() => onRetry()}
        className="rounded-xl bg-fg px-4 py-2 text-xs font-semibold text-bg transition-colors hover:bg-primary hover:text-on-primary"
      >
        Try again
      </button>
    )}
  </div>
);

export const EmptyBox = ({
  title = 'Nothing here yet',
  hint,
  icon: Icon = Inbox
}) => (
  <div className="p-12 text-center">
    <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-subtle">
      <Icon className="h-7 w-7" />
    </span>

    <p className="text-sm font-semibold text-fg">
      {title}
    </p>

    {hint && (
      <p className="mx-auto mt-1 max-w-xs text-sm text-muted">
        {hint}
      </p>
    )}
  </div>
);

/*
 * Compatibility alias.
 *
 * Some pages import EmptyState while the original shared
 * component is named EmptyBox. Keeping this alias prevents
 * import errors without changing the existing EmptyBox API.
 */
export const EmptyState = EmptyBox;

export const Stat = ({
  label,
  value,
  hint,
  tone = 'slate'
}) => {
  // Left accent bar carries the tone;
  // the card itself stays calm in both themes.
  const accents = {
    slate: 'before:bg-line-strong',
    green: 'before:bg-primary',
    amber: 'before:bg-warning',
    red: 'before:bg-danger',
    blue: 'before:bg-info'
  };

  return (
    <div
      className={`card relative overflow-hidden p-4 pl-5 before:absolute before:inset-y-0 before:left-0 before:w-1 ${
        accents[tone] || accents.slate
      }`}
    >
      <p className="text-xs font-semibold text-muted">
        {label}
      </p>

      <p className="mt-1 break-words font-display text-2xl font-extrabold text-fg">
        {value}
      </p>

      {hint && (
        <p className="mt-0.5 text-xs text-subtle">
          {hint}
        </p>
      )}
    </div>
  );
};

const BADGE = {
  green: 'bg-success-soft text-success',
  red: 'bg-danger-soft text-danger',
  amber: 'bg-warning-soft text-warning',
  blue: 'bg-info-soft text-info',
  violet: 'bg-violet-soft text-violet',
  slate: 'bg-surface-3 text-muted'
};

export const Badge = ({
  tone = 'slate',
  children
}) => (
  <span
    className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${
      BADGE[tone] || BADGE.slate
    }`}
  >
    {children}
  </span>
);

export const statusTone = (s) => ({
  CONFIRMED: 'green',
  HOLD: 'amber',
  PENDING_PAYMENT: 'amber',
  EXPIRED: 'slate',
  PENDING: 'amber',
  COMPLETED: 'slate',
  CANCELLED: 'red',
  scheduled: 'green',
  cancelled: 'red',
  completed: 'slate'
}[s] || 'slate');

// Responsive table:
// scrolls sideways on small screens instead of squashing.
export function DataTable({
  columns,
  rows,
  loading,
  error,
  onRetry,
  empty,
  rowKey = '_id'
}) {
  return (
    <div className="card overflow-x-auto">
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox
          message={error}
          onRetry={onRetry}
        />
      ) : !rows?.length ? (
        <EmptyBox {...(empty || {})} />
      ) : (
        <table className="w-full min-w-[40rem] text-left text-[13px]">
          <thead className="border-b border-line bg-surface-2 text-xs font-semibold text-muted">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.label}
                  className="whitespace-nowrap px-4 py-3"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-line text-fg">
            {rows.map((r) => (
              <tr
                key={r[rowKey]}
                className="transition-colors hover:bg-surface-2/60"
              >
                {columns.map((c) => (
                  <td
                    key={c.label}
                    className="px-4 py-3.5 align-top"
                  >
                    {c.render
                      ? c.render(r)
                      : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export const inputCls =
  'w-full rounded-xl border border-field-line bg-field px-3 py-2 text-sm text-fg placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-subtle';

export const btnPrimary =
  'rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-on-primary shadow-sm shadow-primary/20 transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50';

export const btnGhost =
  'rounded-xl border border-field-line px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:border-primary hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-50';

export const btnDanger =
  'rounded-xl border border-danger/40 px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50';

export const Field = ({
  label,
  children,
  hint
}) => (
  <label className="block text-[13px] font-semibold text-fg">
    {label}

    <div className="mt-1.5 font-normal">
      {children}
    </div>

    {hint && (
      <span className="mt-1 block text-xs font-normal text-subtle">
        {hint}
      </span>
    )}
  </label>
);
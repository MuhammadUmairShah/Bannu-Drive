export default function Input({
  label,
  type = 'text',
  name,
  value,
  onChange,
  placeholder,
  error,
  required = false,
  disabled = false,
  className = '',
  icon: Icon,
  helpText,
  autoComplete,
  inputMode,
  min,
  max,
  step
}) {
  return (
    <div className={`w-full ${className}`}>
      {label && (
        <label htmlFor={name} className="mb-1.5 block text-[13px] font-semibold text-fg">
          {label} {required && <span className="text-danger" aria-hidden="true">*</span>}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-subtle">
            <Icon className="h-4 w-4" />
          </div>
        )}
        <input
          type={type}
          name={name}
          id={name}
          disabled={disabled}
          autoComplete={autoComplete}
          inputMode={inputMode}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          className={`block w-full rounded-xl border bg-field py-2.5 pr-3.5 text-sm text-fg transition-colors placeholder:text-subtle focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-2 disabled:text-subtle ${
            Icon ? 'pl-10' : 'pl-3.5'
          } ${
            error
              ? 'border-danger focus:border-danger focus:ring-danger/25'
              : 'border-field-line focus:border-primary focus:ring-primary/25'
          }`}
        />
      </div>
      {error && <p className="mt-1.5 text-xs font-medium text-danger">{error}</p>}
      {helpText && !error && <p className="mt-1.5 text-xs text-muted">{helpText}</p>}
    </div>
  );
}

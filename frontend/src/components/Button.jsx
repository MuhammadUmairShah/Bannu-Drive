export default function Button({
  children,
  type = 'button',
  variant = 'primary',
  size = 'md',
  disabled = false,
  fullWidth = false,
  onClick,
  className = '',
  icon: Icon
}) {
  const baseStyles =
    'inline-flex items-center justify-center rounded-xl font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100';

  const variants = {
    primary: 'bg-primary text-on-primary hover:bg-primary-hover shadow-sm shadow-primary/25',
    // High-contrast neutral: dark button in light theme, light button in dark theme
    secondary: 'bg-fg text-bg hover:bg-primary hover:text-on-primary shadow-sm',
    outline: 'border border-field-line bg-transparent text-fg hover:border-primary hover:bg-primary-soft',
    danger: 'bg-danger-solid text-on-danger hover:bg-danger-solid-hover shadow-sm',
    ghost: 'text-muted hover:bg-surface-2 hover:text-fg'
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-6 py-3 text-base'
  };

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {Icon && <Icon className={`w-4 h-4 ${children ? 'mr-2' : ''}`} />}
      {children}
    </button>
  );
}

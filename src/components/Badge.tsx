type BadgeVariant = "default" | "warning" | "muted";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
}

export function Badge({ children, variant = "default" }: BadgeProps) {
  const variantStyles = {
    default: "bg-slate-200 text-slate-700",
    warning: "bg-slate-300 text-slate-700",
    muted: "bg-slate-100 text-slate-600",
  };

  return (
    <span
      className={`px-2 py-0.5 text-xs rounded-full ${variantStyles[variant]}`}
    >
      {children}
    </span>
  );
}

import { ReactNode } from "react";

/**
 * Shared page header: orange eyebrow rule + serif display title.
 * Keeps every page's heading identical for a consistent, branded look.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="flex items-center gap-2.5 mb-2">
          <span className="h-px w-6 bg-[var(--brand-accent)]" aria-hidden />
          <span className="text-[11px] font-semibold tracking-[0.18em] uppercase text-[var(--brand-accent)]">
            {eyebrow}
          </span>
        </div>
        <h1 className="font-display text-[26px] sm:text-3xl font-semibold tracking-tight text-foreground leading-snug">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1.5">{description}</p>
        )}
      </div>
      {actions && <div className="flex gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

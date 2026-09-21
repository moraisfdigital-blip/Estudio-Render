import type { ReactNode } from 'react'

/** Primitivas visuais da Fase 3. Só tons neutros — cor de marca entra por env/tema, nunca no código. */

type FieldProps = {
  label: string
  htmlFor: string
  hint?: string
  required?: boolean
  children: ReactNode
}

export function Field({ label, htmlFor, hint, required, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm text-ink-soft">
        {label}
        {required && <span className="ml-1 text-ink-dim">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-ink-dim">{hint}</p>}
    </div>
  )
}

export const inputClass =
  'w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink ' +
  'placeholder:text-ink-dim outline-none transition focus:border-ink-dim ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'quiet' }) {
  const styles = {
    primary:
      'bg-brand text-brand-ink hover:bg-brand-hover disabled:bg-raised disabled:text-ink-dim',
    ghost:
      'border border-line text-ink hover:border-ink-dim hover:text-ink',
    quiet: 'text-ink-soft hover:text-ink',
  }[variant]

  return (
    <button
      {...props}
      className={`rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${styles} ${className}`}
    />
  )
}

/** Erro sempre visível e sempre com saída: mensagem do servidor + ação de repetir. */
export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-bad bg-bad-soft px-4 py-3"
    >
      <p className="text-sm text-bad">{message}</p>
      {onRetry && (
        <Button variant="ghost" type="button" onClick={onRetry}>
          Tentar de novo
        </Button>
      )}
    </div>
  )
}

export function Loading({ label }: { label: string }) {
  return (
    <p role="status" className="py-10 text-center text-sm text-ink-dim">
      {label}
    </p>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-14 text-center">
      <h2 className="text-base font-medium text-ink">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-ink-dim">{description}</p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  )
}

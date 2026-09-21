import type { FormEvent, ReactNode } from 'react'
import Marca from './layout/Marca'

/** Casca das telas de auth: título, erro e ação secundária. */
export function AuthCard({
  title,
  subtitle,
  error,
  onSubmit,
  children,
  footer,
}: {
  title: string
  subtitle: string
  error: string | null
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <main className="min-h-dvh bg-app text-ink flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-1">
          <Marca className="text-xl" />
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-ink-soft">{subtitle}</p>
        </header>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {children}

          {error && (
            <p role="alert" className="text-sm text-bad border border-bad bg-bad-soft rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </form>

        <p className="text-sm text-ink-soft">{footer}</p>
      </div>
    </main>
  )
}

export function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
  disabled,
  minLength,
}: {
  label: string
  type: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  disabled?: boolean
  minLength?: number
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm text-ink-soft">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        disabled={disabled}
        minLength={minLength}
        required
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-ink-dim disabled:opacity-60"
      />
    </label>
  )
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-brand px-3 py-2 font-medium text-brand-ink transition hover:bg-brand-hover disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {pending ? 'Enviando…' : children}
    </button>
  )
}

export function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-ink underline underline-offset-4">
      {children}
    </button>
  )
}

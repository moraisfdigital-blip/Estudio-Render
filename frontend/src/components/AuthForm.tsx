import type { FormEvent, ReactNode } from 'react'

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
    <main className="min-h-dvh bg-neutral-950 text-neutral-100 flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">ENBY PRO</p>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-neutral-400">{subtitle}</p>
        </header>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {children}

          {error && (
            <p role="alert" className="text-sm text-red-400 border border-red-900/60 bg-red-950/40 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </form>

        <p className="text-sm text-neutral-400">{footer}</p>
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
      <span className="text-sm text-neutral-300">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        disabled={disabled}
        minLength={minLength}
        required
        className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-500 disabled:opacity-60"
      />
    </label>
  )
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-neutral-100 px-3 py-2 font-medium text-neutral-950 transition hover:bg-white disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {pending ? 'Enviando…' : children}
    </button>
  )
}

export function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-neutral-100 underline underline-offset-4">
      {children}
    </button>
  )
}

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
      <label htmlFor={htmlFor} className="text-sm text-neutral-300">
        {label}
        {required && <span className="ml-1 text-neutral-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
    </div>
  )
}

export const inputClass =
  'w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 ' +
  'placeholder:text-neutral-600 outline-none transition focus:border-neutral-400 ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'quiet' }) {
  const styles = {
    primary:
      'bg-neutral-100 text-neutral-900 hover:bg-white disabled:bg-neutral-700 disabled:text-neutral-400',
    ghost:
      'border border-neutral-700 text-neutral-200 hover:border-neutral-500 hover:text-neutral-100',
    quiet: 'text-neutral-400 hover:text-neutral-100',
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
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3"
    >
      <p className="text-sm text-red-200">{message}</p>
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
    <p role="status" className="py-10 text-center text-sm text-neutral-500">
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
    <div className="rounded-lg border border-dashed border-neutral-800 px-6 py-14 text-center">
      <h2 className="text-base font-medium text-neutral-200">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-neutral-500">{description}</p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  )
}

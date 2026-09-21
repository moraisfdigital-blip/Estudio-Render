import { useState } from 'react'
import {
  createClient,
  createLocation,
  errorMessage,
  type Client,
  type Location,
} from '../api/client'
import { Button, Field, inputClass } from './ui'

/** Painel de criação embutido: cadastrar cliente/local sem sair do formulário do projeto. */
function InlinePanel({
  open,
  onToggle,
  openLabel,
  children,
}: {
  open: boolean
  onToggle: () => void
  openLabel: string
  children: React.ReactNode
}) {
  return (
    <>
      <Button variant="quiet" type="button" onClick={onToggle} className="self-start px-0">
        {open ? 'Cancelar' : openLabel}
      </Button>
      {open && (
        <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
          {children}
        </div>
      )}
    </>
  )
}

function PanelError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="text-sm text-bad">
      {message}
    </p>
  )
}

export function ClientPicker({
  clients,
  value,
  onChange,
  onCreated,
  disabled,
}: {
  clients: Client[]
  value: string
  onChange: (id: string) => void
  onCreated: (client: Client) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const created = await createClient({ name, contact_name: contact })
      onCreated(created)
      onChange(created.id)
      setName('')
      setContact('')
      setOpen(false)
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível salvar o cliente.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Field label="Cliente" htmlFor="project-client" required>
        <select
          id="project-client"
          className={inputClass}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Selecione um cliente…</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </Field>

      <InlinePanel open={open} onToggle={() => setOpen(!open)} openLabel="+ Novo cliente">
        <Field label="Nome do cliente" htmlFor="new-client-name" required>
          <input
            id="new-client-name"
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Posto Ipiranga Centro"
          />
        </Field>
        <Field label="Contato" htmlFor="new-client-contact">
          <input
            id="new-client-contact"
            className={inputClass}
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            placeholder="Nome de quem acompanha a obra"
          />
        </Field>
        <PanelError message={error} />
        <Button
          type="button"
          onClick={() => void submit()}
          disabled={saving || name.trim().length === 0}
          className="self-start"
        >
          {saving ? 'Salvando…' : 'Salvar cliente'}
        </Button>
      </InlinePanel>
    </div>
  )
}

export function LocationPicker({
  locations,
  value,
  onChange,
  onCreated,
  clientId,
  disabled,
}: {
  locations: Location[]
  value: string
  onChange: (id: string) => void
  onCreated: (location: Location) => void
  /** Cliente escolhido no projeto: o local novo já nasce vinculado a ele. */
  clientId: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const created = await createLocation({
        name,
        address,
        city,
        client_id: clientId || null,
      })
      onCreated(created)
      onChange(created.id)
      setName('')
      setAddress('')
      setCity('')
      setOpen(false)
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível salvar o local.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Field
        label="Local"
        htmlFor="project-location"
        required
        hint="O sítio do levantamento: posto, loja, fachada."
      >
        <select
          id="project-location"
          className={inputClass}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Selecione um local…</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
              {location.city ? ` — ${location.city}` : ''}
            </option>
          ))}
        </select>
      </Field>

      <InlinePanel open={open} onToggle={() => setOpen(!open)} openLabel="+ Novo local">
        <Field label="Nome do local" htmlFor="new-location-name" required>
          <input
            id="new-location-name"
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Fachada — Av. Paulista 900"
          />
        </Field>
        <Field label="Endereço" htmlFor="new-location-address">
          <input
            id="new-location-address"
            className={inputClass}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </Field>
        <Field label="Cidade" htmlFor="new-location-city">
          <input
            id="new-location-city"
            className={inputClass}
            value={city}
            onChange={(event) => setCity(event.target.value)}
          />
        </Field>
        <PanelError message={error} />
        <Button
          type="button"
          onClick={() => void submit()}
          disabled={saving || name.trim().length === 0}
          className="self-start"
        >
          {saving ? 'Salvando…' : 'Salvar local'}
        </Button>
      </InlinePanel>
    </div>
  )
}

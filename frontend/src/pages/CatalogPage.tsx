import { useCallback, useState } from 'react'
import {
  createBrand,
  createFinish,
  createMaterial,
  errorMessage,
  listBrands,
  listFinishes,
  listMaterials,
  uploadBrandLogo,
  type Brand,
  type Finish,
  type Material,
} from '../api/client'
import BrandLogo from '../components/BrandLogo'
import { Button, EmptyState, ErrorNotice, Field, Loading, inputClass } from '../components/ui'
import { useResource } from '../hooks/useResource'

/**
 * Catálogo do workspace: material, acabamento (com a cor real) e marca.
 *
 * Esta tela é do owner. O editor não chega aqui — e se chegasse, a API
 * responderia 403; o botão some, mas quem decide continua sendo o servidor.
 *
 * A cor é cadastrada aqui e lida de volta do servidor em toda a aplicação.
 * Nenhum hex de marca vive no código.
 */

type Catalog = { materials: Material[]; finishes: Finish[]; brands: Brand[] }

/** Cor precisa de nome e de hex: o hex desenha, o nome é o que vai pra fábrica. */
const DEFAULT_SWATCH = '#808080'

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-line p-5">
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      <p className="mt-1 text-xs text-ink-dim">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function MaterialsSection({
  materials,
  onCreated,
}: {
  materials: Material[]
  onCreated: (material: Material) => void
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      onCreated(await createMaterial({ name }))
      setName('')
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível cadastrar o material.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      title="Materiais"
      description="O que a sua empresa usa para fabricar: ACM, vinil, acrílico, chapa."
    >
      {error && <ErrorNotice message={error} />}

      {materials.length === 0 ? (
        <p className="text-xs text-ink-dim">
          Nenhum material ainda. Cadastre o primeiro para poder especificar elementos.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {materials.map((material) => (
            <li
              key={material.id}
              className="flex items-baseline justify-between gap-3 border-b border-line-soft pb-1.5 text-sm"
            >
              <span className="text-ink">{material.name}</span>
              <span className="shrink-0 text-xs text-ink-dim">
                {material.finish_count === 0
                  ? 'sem acabamento'
                  : `${material.finish_count} acabamento${material.finish_count > 1 ? 's' : ''}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <Field label="Novo material" htmlFor="material-name">
            <input
              id="material-name"
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: ACM"
            />
          </Field>
        </div>
        <Button type="submit" disabled={!name.trim() || saving}>
          {saving ? 'Salvando…' : 'Adicionar'}
        </Button>
      </form>
    </Section>
  )
}

function FinishesSection({
  materials,
  finishes,
  onCreated,
}: {
  materials: Material[]
  finishes: Finish[]
  onCreated: (finish: Finish) => void
}) {
  const [materialId, setMaterialId] = useState('')
  const [name, setName] = useState('')
  const [colorName, setColorName] = useState('')
  const [colorHex, setColorHex] = useState(DEFAULT_SWATCH)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = materialId !== '' && name.trim() !== '' && colorName.trim() !== ''

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!ready || saving) return
    setSaving(true)
    setError(null)
    try {
      onCreated(
        await createFinish({
          material_id: materialId,
          name,
          color_name: colorName,
          color_hex: colorHex,
        }),
      )
      setName('')
      setColorName('')
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível cadastrar o acabamento.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      title="Acabamentos e cores"
      description="Variante de um material, com a cor real. É daqui que a cor sai para a proposta."
    >
      {error && <ErrorNotice message={error} />}

      {materials.length === 0 ? (
        <p className="text-xs text-ink-dim">
          Cadastre um material primeiro: acabamento é sempre variante de algum material.
        </p>
      ) : (
        <>
          {finishes.length === 0 ? (
            <p className="text-xs text-ink-dim">Nenhum acabamento cadastrado ainda.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {finishes.map((finish) => (
                <li
                  key={finish.id}
                  className="flex items-center justify-between gap-3 border-b border-line-soft pb-1.5 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="inline-block size-3 shrink-0 rounded-sm border border-ink-dim"
                      style={{ backgroundColor: finish.color_hex }}
                      role="img"
                      aria-label={`Cor ${finish.color_name}`}
                    />
                    <span className="truncate text-ink">{finish.name}</span>
                    <span className="shrink-0 text-xs text-ink-dim">{finish.color_name}</span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-dim">{finish.material_name}</span>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
            <Field label="Material" htmlFor="finish-material" required>
              <select
                id="finish-material"
                className={inputClass}
                value={materialId}
                onChange={(event) => setMaterialId(event.target.value)}
              >
                <option value="">Selecione…</option>
                {materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-40 flex-1">
                <Field label="Acabamento" htmlFor="finish-name" required>
                  <input
                    id="finish-name"
                    className={inputClass}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ex.: Brilho"
                  />
                </Field>
              </div>
              <div className="min-w-40 flex-1">
                <Field label="Nome da cor" htmlFor="finish-color-name" required>
                  <input
                    id="finish-color-name"
                    className={inputClass}
                    value={colorName}
                    onChange={(event) => setColorName(event.target.value)}
                    placeholder="Ex.: Branco"
                  />
                </Field>
              </div>
              <div>
                <label htmlFor="finish-color-hex" className="text-sm text-ink-soft">
                  Cor
                </label>
                <input
                  id="finish-color-hex"
                  type="color"
                  className="mt-1.5 block h-9 w-16 cursor-pointer rounded-md border border-line bg-surface"
                  value={colorHex}
                  onChange={(event) => setColorHex(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={!ready || saving}>
                {saving ? 'Salvando…' : 'Adicionar'}
              </Button>
            </div>
          </form>
        </>
      )}
    </Section>
  )
}

function BrandsSection({
  brands,
  onSaved,
}: {
  brands: Brand[]
  onSaved: (brand: Brand) => void
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      onSaved(await createBrand({ name }))
      setName('')
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível cadastrar a marca.'))
    } finally {
      setSaving(false)
    }
  }

  async function chooseLogo(brandId: string, file: File | undefined) {
    if (!file) return
    setUploading(brandId)
    setError(null)
    try {
      onSaved(await uploadBrandLogo(brandId, file))
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível enviar o logo.'))
    } finally {
      setUploading(null)
    }
  }

  return (
    <Section
      title="Marcas e logos"
      description="Identidade aplicada na proposta. O logo é opcional e fica guardado como arquivo."
    >
      {error && <ErrorNotice message={error} />}

      {brands.length === 0 ? (
        <p className="text-xs text-ink-dim">Nenhuma marca cadastrada ainda.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {brands.map((brand) => (
            <li
              key={brand.id}
              className="flex items-center justify-between gap-3 border-b border-line-soft pb-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                {brand.logo && <BrandLogo brandId={brand.id} name={brand.name} />}
                <span className="truncate text-ink">{brand.name}</span>
              </span>
              <label className="shrink-0 cursor-pointer text-xs text-ink-dim underline-offset-2 hover:text-ink-soft hover:underline">
                {uploading === brand.id
                  ? 'Enviando…'
                  : brand.logo
                    ? 'Trocar logo'
                    : 'Enviar logo'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={uploading !== null}
                  onChange={(event) => {
                    void chooseLogo(brand.id, event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
              </label>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <Field label="Nova marca" htmlFor="brand-name">
            <input
              id="brand-name"
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Posto Ipiranga"
            />
          </Field>
        </div>
        <Button type="submit" disabled={!name.trim() || saving}>
          {saving ? 'Salvando…' : 'Adicionar'}
        </Button>
      </form>
    </Section>
  )
}

export default function CatalogPage({
  onBack,
  canManage,
}: {
  onBack: () => void
  canManage: boolean
}) {
  const load = useCallback(async (): Promise<Catalog> => {
    const [materials, finishes, brands] = await Promise.all([
      listMaterials(),
      listFinishes(),
      listBrands(),
    ])
    return { materials, finishes, brands }
  }, [])

  const { resource, reload, patch } = useResource(load, 'Não foi possível carregar o catálogo.')

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-ink-soft transition hover:text-ink"
      >
        ← Projetos
      </button>

      <h1 className="mt-4 text-2xl font-semibold">Catálogo</h1>
      <p className="mt-1 text-sm text-ink-dim">
        Material, acabamento e marca deste workspace. A cor da proposta sai daqui.
      </p>

      {resource.kind === 'loading' && <Loading label="Carregando catálogo…" />}
      {resource.kind === 'error' && (
        <div className="mt-8">
          <ErrorNotice message={resource.message} onRetry={reload} />
        </div>
      )}

      {resource.kind === 'ready' &&
        (canManage ? (
          <div className="mt-8 flex flex-col gap-5">
            <MaterialsSection
              materials={resource.data.materials}
              onCreated={(material) =>
                patch((current) => ({
                  ...current,
                  materials: [...current.materials, material].sort((a, b) =>
                    a.name.localeCompare(b.name),
                  ),
                }))
              }
            />
            <FinishesSection
              materials={resource.data.materials}
              finishes={resource.data.finishes}
              onCreated={(finish) =>
                patch((current) => ({
                  ...current,
                  finishes: [...current.finishes, finish].sort((a, b) =>
                    a.name.localeCompare(b.name),
                  ),
                  // O contador do material acompanha sem precisar recarregar tudo.
                  materials: current.materials.map((material) =>
                    material.id === finish.material_id
                      ? { ...material, finish_count: material.finish_count + 1 }
                      : material,
                  ),
                }))
              }
            />
            <BrandsSection
              brands={resource.data.brands}
              onSaved={(brand) =>
                patch((current) => ({
                  ...current,
                  brands: current.brands.some((item) => item.id === brand.id)
                    ? current.brands.map((item) => (item.id === brand.id ? brand : item))
                    : [...current.brands, brand].sort((a, b) => a.name.localeCompare(b.name)),
                }))
              }
            />
          </div>
        ) : (
          <div className="mt-8">
            <EmptyState
              title="Catálogo é do owner"
              description="Você entra como editor: dá para escolher material, acabamento e marca nos elementos, mas cadastrar itens novos é do owner do workspace."
              action={
                <Button variant="ghost" type="button" onClick={onBack}>
                  Voltar para os projetos
                </Button>
              }
            />
          </div>
        ))}
    </div>
  )
}

import { useCallback, useState } from 'react'
import {
  applySpec,
  errorMessage,
  listBrands,
  listFinishes,
  listMaterials,
  type Brand,
  type Finish,
  type Material,
  type SpecInput,
  type SurveyElement,
} from '../api/client'
import { useAuth } from '../auth/context'
import BrandLogo from './BrandLogo'
import { ErrorNotice, Loading, inputClass } from './ui'
import { useResource } from '../hooks/useResource'

/**
 * Seletor de material, acabamento e marca de um elemento.
 *
 * A cor mostrada aqui vem inteira do catálogo: `color_hex` é lido do
 * acabamento cadastrado e usado direto no `style`. Não existe paleta, mapa de
 * cores nem valor padrão neste arquivo — se ninguém cadastrou a cor, não há
 * cor para mostrar.
 */

type Catalog = { materials: Material[]; finishes: Finish[]; brands: Brand[] }

/** Amostra da cor do acabamento. O quadrado é desenhado com o hex do cadastro. */
function ColorDot({ hex, label }: { hex: string; label: string }) {
  return (
    <span
      className="inline-block size-3 shrink-0 rounded-sm border border-ink-dim"
      style={{ backgroundColor: hex }}
      role="img"
      aria-label={`Cor ${label}`}
      title={`${label} (${hex})`}
    />
  )
}

/** Resumo do que está aplicado hoje — some quando nada foi especificado. */
function AppliedSpec({ spec }: { spec: SurveyElement['spec'] }) {
  if (spec.is_empty) {
    return (
      <p className="text-xs text-ink-dim">
        Sem especificação. O elemento está marcado e medido, mas ninguém decidiu do que ele é
        feito.
      </p>
    )
  }

  return (
    <dl className="flex flex-col gap-1.5 text-xs">
      {spec.material && (
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-ink-dim">Material</dt>
          <dd className="text-ink">{spec.material.name}</dd>
        </div>
      )}
      {spec.finish && (
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-ink-dim">Acabamento</dt>
          <dd className="flex items-center gap-1.5 text-ink">
            {spec.finish.name}
            <ColorDot hex={spec.finish.color_hex} label={spec.finish.color_name} />
            <span className="text-ink-soft">{spec.finish.color_name}</span>
          </dd>
        </div>
      )}
      {spec.brand && (
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-ink-dim">Marca</dt>
          <dd className="flex items-center gap-2 text-ink">
            {spec.brand.logo_url && (
              <BrandLogo
                brandId={spec.brand.id}
                name={spec.brand.name}
                className="h-4 w-auto max-w-16 object-contain"
              />
            )}
            {spec.brand.name}
          </dd>
        </div>
      )}
    </dl>
  )
}

export default function SpecPicker({
  element,
  onChanged,
}: {
  element: SurveyElement
  onChanged: (element: SurveyElement) => void
}) {
  const { state } = useAuth()
  // Owner administra o catálogo; editor só escolhe o que já existe. O texto do
  // estado vazio muda, mas quem recusa de verdade é a API (403).
  const canManageCatalog = state.kind === 'authenticated' && state.session.user.role === 'owner'

  const load = useCallback(async (): Promise<Catalog> => {
    const [materials, finishes, brands] = await Promise.all([
      listMaterials(),
      listFinishes(),
      listBrands(),
    ])
    return { materials, finishes, brands }
  }, [])

  const { resource, reload } = useResource(load, 'Não foi possível carregar o catálogo.')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (resource.kind === 'loading') return <Loading label="Carregando catálogo…" />
  if (resource.kind === 'error') {
    return <ErrorNotice message={resource.message} onRetry={reload} />
  }

  const { materials, finishes, brands } = resource.data
  const spec = element.spec
  const materialId = spec.material?.id ?? ''
  const finishId = spec.finish?.id ?? ''
  const brandId = spec.brand?.id ?? ''
  // Acabamento é variante de um material: a lista só mostra os do material escolhido.
  const available = finishes.filter((item) => item.material_id === materialId)

  async function apply(input: SpecInput) {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      onChanged(await applySpec(element.id, input))
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível aplicar a especificação.'))
    } finally {
      setSaving(false)
    }
  }

  /** Trocar de material invalida o acabamento anterior, que era de outro material. */
  function chooseMaterial(value: string) {
    void apply({ material_id: value || null, finish_id: null })
  }

  if (materials.length === 0 && brands.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-line px-4 py-6 text-center">
        <p className="text-xs text-ink-soft">
          Nenhum material cadastrado ainda. O que a peça é feita sai do catálogo da sua empresa, não
          de texto livre.
        </p>
        <p className="mt-3 text-[11px] text-ink-dim">
          {canManageCatalog
            ? 'Cadastre em Catálogo, no topo da página.'
            : 'Só o owner do workspace cadastra material, acabamento e marca.'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <AppliedSpec spec={spec} />

      {error && <ErrorNotice message={error} />}

      <div className="flex flex-col gap-2">
        <div>
          <label htmlFor="spec-material" className="text-xs text-ink-dim">
            Material
          </label>
          <select
            id="spec-material"
            className={`${inputClass} mt-1`}
            value={materialId}
            disabled={saving}
            onChange={(event) => chooseMaterial(event.target.value)}
          >
            <option value="">Sem material</option>
            {materials.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="spec-finish" className="text-xs text-ink-dim">
            Acabamento e cor
          </label>
          <select
            id="spec-finish"
            className={`${inputClass} mt-1`}
            value={finishId}
            disabled={saving || materialId === ''}
            onChange={(event) => void apply({ finish_id: event.target.value || null })}
          >
            <option value="">Sem acabamento</option>
            {available.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} — {item.color_name}
              </option>
            ))}
          </select>
          {materialId === '' ? (
            <p className="mt-1 text-[10px] text-ink-dim">
              Escolha o material primeiro: acabamento é variante de um material.
            </p>
          ) : (
            available.length === 0 && (
              <p className="mt-1 text-[10px] text-ink-dim">
                Este material ainda não tem acabamento cadastrado.
              </p>
            )
          )}
        </div>

        <div>
          <label htmlFor="spec-brand" className="text-xs text-ink-dim">
            Marca
          </label>
          <select
            id="spec-brand"
            className={`${inputClass} mt-1`}
            value={brandId}
            disabled={saving}
            onChange={(event) => void apply({ brand_id: event.target.value || null })}
          >
            <option value="">Sem marca</option>
            {brands.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {saving && <p className="text-[10px] text-ink-dim">Salvando especificação…</p>}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { Filter, RefreshCw } from 'lucide-react'
import MultiSelect from './MultiSelect.jsx'
import YearRange from './YearRange.jsx'
import { getFilters, getMunicipios } from '../../api/client.js'

const EMPTY_FILTERS = {
  departamentos: [],
  municipios: [],
  codedes: [],
  sectores: [],
  instituciones: [],
  year_min: null,
  year_max: null,
  etapas: [],
}

/**
 * FilterPanel
 *
 * Props:
 *   value: filters object (controlled)
 *   onApply: (filters) => void   // called when user clicks "Aplicar"
 *   variant: 'dark' (sidebar) | 'light'
 *   compact: boolean
 */
export default function FilterPanel({ value, onApply, variant = 'dark' }) {
  const [meta, setMeta] = useState({
    departamentos: [],
    codedes: [],
    sectores: [],
    instituciones: [],
    etapas: [],
    year_min: null,
    year_max: null,
  })
  const [municipios, setMunicipios] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState(value || EMPTY_FILTERS)

  // Sync draft if parent resets
  useEffect(() => {
    if (value) setDraft(value)
  }, [value])

  // Load filter options once
  useEffect(() => {
    let active = true
    setLoading(true)
    getFilters()
      .then((data) => {
        if (!active) return
        setMeta({
          departamentos: data.departamentos || [],
          codedes: data.codedes || [],
          sectores: data.sectores || [],
          instituciones: data.instituciones || [],
          etapas: data.etapas || [],
          year_min: data.year_min,
          year_max: data.year_max,
        })
        // Initialize year range if not set yet
        setDraft((d) => ({
          ...d,
          year_min: d.year_min ?? data.year_min,
          year_max: d.year_max ?? data.year_max,
        }))
      })
      .catch((err) => active && setError(err?.message || 'Error al cargar filtros'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  // Load municipios on department change
  const loadMunis = useCallback(async (depts) => {
    try {
      const data = await getMunicipios(depts || [])
      setMunicipios(data.municipios || [])
    } catch {
      setMunicipios([])
    }
  }, [])

  useEffect(() => {
    loadMunis(draft.departamentos)
  }, [draft.departamentos, loadMunis])

  const update = (patch) => setDraft((d) => ({ ...d, ...patch }))

  const handleClear = () => {
    const cleared = {
      ...EMPTY_FILTERS,
      year_min: meta.year_min,
      year_max: meta.year_max,
    }
    setDraft(cleared)
    onApply?.(cleared)
  }

  const handleApply = () => {
    onApply?.(draft)
  }

  const hasActiveFilters =
    draft.departamentos.length > 0 ||
    draft.municipios.length > 0 ||
    draft.codedes.length > 0 ||
    draft.sectores.length > 0 ||
    draft.instituciones.length > 0 ||
    draft.etapas.length > 0 ||
    draft.year_min !== meta.year_min ||
    draft.year_max !== meta.year_max

  const dark = variant === 'dark'
  const labelCls = dark ? 'text-white/60' : 'text-ink-500 dark:text-d-muted'
  const headerCls = dark ? 'text-white' : 'text-ink-800 dark:text-d-text'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${dark ? 'bg-white/10 text-white' : 'bg-accent-soft text-accent'}`}>
          <Filter size={15} />
        </span>
        <div>
          <h3 className={`text-sm font-semibold ${headerCls}`} style={{ fontFamily: 'Inter' }}>
            Filtros
          </h3>
          <p className={`text-[11px] ${labelCls}`}>Refina el análisis presupuestario</p>
        </div>
      </div>

      {error ? (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
          {error}
        </div>
      ) : null}

      <div className="flex flex-col gap-3.5">
        <MultiSelect
          label="Departamento"
          options={meta.departamentos}
          value={draft.departamentos}
          onChange={(v) => update({ departamentos: v, municipios: [] })}
          onApply={handleApply}
          disabled={loading}
          variant={variant}
        />
        <MultiSelect
          label="Municipalidad"
          options={municipios}
          value={draft.municipios}
          onChange={(v) => update({ municipios: v })}
          onApply={handleApply}
          disabled={loading}
          variant={variant}
        />
        <MultiSelect
          label="Codedes"
          options={meta.codedes}
          value={draft.codedes}
          onChange={(v) => update({ codedes: v })}
          onApply={handleApply}
          disabled={loading}
          variant={variant}
        />
        <MultiSelect
          label="Sector"
          options={meta.sectores}
          value={draft.sectores}
          onChange={(v) => update({ sectores: v })}
          onApply={handleApply}
          disabled={loading}
          variant={variant}
        />
        <MultiSelect
          label="Institución"
          options={meta.instituciones}
          value={draft.instituciones}
          onChange={(v) => update({ instituciones: v })}
          onApply={handleApply}
          disabled={loading}
          variant={variant}
        />
        <YearRange
          min={meta.year_min}
          max={meta.year_max}
          value={[draft.year_min ?? meta.year_min, draft.year_max ?? meta.year_max]}
          onChange={([a, b]) => update({ year_min: a, year_max: b })}
          variant={variant}
        />
        <MultiSelect
          label="Etapa actual"
          options={meta.etapas}
          value={draft.etapas}
          onChange={(v) => update({ etapas: v })}
          onApply={handleApply}
          disabled={loading}
          variant={variant}
        />
      </div>

      <div className="flex flex-col gap-2 pt-2">
        {hasActiveFilters ? (
          <>
            <button
              type="button"
              onClick={handleApply}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <RefreshCw size={14} />
              Aplicar filtros
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={loading}
              className={`inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${dark ? 'bg-white/5 hover:bg-white/10 text-white/80' : 'bg-canvas hover:bg-line/40 text-ink-800 dark:bg-d-canvas dark:text-d-text'}`}
            >
              Limpiar
            </button>
          </>
        ) : null}
        <div className={`rounded-lg px-3 py-2 text-xs border ${dark ? 'border-white/15 bg-white/5 text-white/80' : 'border-line dark:border-d-line bg-canvas/60 dark:bg-d-canvas text-ink-600 dark:text-d-muted'}`}>
          <div className="uppercase tracking-wide text-[12px] opacity-80">Suma ponderada de alertas activas (máx. 100)</div>
          <ul className="mt-1.5 space-y-0.5 text-[14px] leading-4">
            <li>• Gasto sin meta física +30</li>
            <li>• Adjudicación directa +20</li>
            <li>• Oferente único +20</li>
            <li>• Proyecto sospechoso +20</li>
            <li>• Fraccionamiento +15</li>
            <li>• Meta baja con gasto +10</li>
            <li>• Modificación excesiva +10</li>
            <li>• Sobreejecución financiera +10</li>
            <li>• Año previo a elecciones +5</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

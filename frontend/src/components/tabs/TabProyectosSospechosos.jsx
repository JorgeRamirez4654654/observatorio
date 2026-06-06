import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Gavel,
  Scissors,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import L from 'leaflet'
import { GeoJSON, MapContainer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { getProyectosSospechosos } from '../../api/client.js'
import { formatMoney, formatNumber, formatPercent } from '../../utils/format.js'
import LoadingSpinner from '../common/LoadingSpinner.jsx'
import EmptyState from '../common/EmptyState.jsx'
import SectionCard from '../common/SectionCard.jsx'
import DataTable from '../common/DataTable.jsx'
import KpiCard from '../common/KpiCard.jsx'
import InfoTooltip from '../common/InfoTooltip.jsx'

// ─── Flag metadata ─────────────────────────────────────────────────────────────
const FLAG_META = {
  sospechoso: {
    label: 'Proyecto sospechoso',
    accent: 'danger',
    Icon: AlertTriangle,
    explanation:
      'El gasto financiero supera el 95 % del presupuesto pero la meta física ejecutada es menor al 50 %. Indica dinero desembolsado sin avance real en obra.',
  },
  sin_meta_ejecutada_con_gasto: {
    label: 'Gasto sin meta física',
    accent: 'danger',
    Icon: TrendingDown,
    explanation:
      'El proyecto reporta gasto ejecutado pero la meta física está en cero. El dinero salió pero no existe ningún avance físico registrado.',
  },
  meta_baja_con_gasto: {
    label: 'Meta baja con gasto significativo',
    accent: 'warn',
    Icon: TrendingDown,
    explanation:
      'La meta física alcanzada es menor al 10 % del total pero el gasto reportado supera Q50 000. Posible subdeclaración del avance o gasto prematuro.',
  },
  sobreejecucion_financiera: {
    label: 'Sobreejecución financiera',
    accent: 'warn',
    Icon: TrendingUp,
    explanation:
      'El monto ejecutado supera el monto adjudicado. El contrato fue financieramente sobrepasado sin justificación registrada.',
  },
  adjudicacion_directa: {
    label: 'Adjudicación directa',
    accent: 'danger',
    Icon: Gavel,
    explanation:
      'El contrato fue adjudicado directamente sin proceso competitivo (método "direct" en OCDS de GuateCompras). Aumenta el riesgo de favoritismo y sobreprecio.',
  },
  oferente_unico: {
    label: 'Oferente único',
    accent: 'danger',
    Icon: Users,
    explanation:
      'La licitación fue formalmente abierta pero solo participó un oferente. Puede indicar acuerdo previo o especificaciones diseñadas para favorecer a un proveedor específico.',
  },
  fraccionamiento: {
    label: 'Fraccionamiento de contratos',
    accent: 'danger',
    Icon: Scissors,
    explanation:
      'El proveedor recibió múltiples contratos que en conjunto superan Q900 000 pero individualmente no, evitando la licitación pública obligatoria (Decreto 57-92).',
  },
  modificacion_excesiva: {
    label: 'Modificación excesiva de contrato',
    accent: 'warn',
    Icon: Wrench,
    explanation:
      'El monto vigente supera en más del 20 % al monto inicial aprobado. Aumentos injustificados tras la adjudicación son una señal de corrupción.',
  },
}

// ─── Risk color legend ─────────────────────────────────────────────────────────
const RISK_LEGEND = [
  {
    key: 'sin_meta',
    label: 'Riesgo crítico',
    row: 'bg-red-100 dark:bg-red-900/30',
    dot: 'bg-red-500',
    desc: 'Gasto sin meta · Adjudicación directa',
  },
  {
    key: 'sospechoso',
    label: 'Riesgo alto',
    row: 'bg-red-50 dark:bg-red-900/15',
    dot: 'bg-red-300',
    desc: 'Sospechoso · Oferente único · Meta baja',
  },
  {
    key: 'sobreejecucion',
    label: 'Riesgo medio',
    row: 'bg-yellow-50 dark:bg-yellow-900/15',
    dot: 'bg-yellow-400',
    desc: 'Sobreejecución · Fraccionamiento · Mod. excesiva',
  },
]

const METHOD_LABEL = {
  directa: 'Compra Directa', excepcion: 'Excepción (Art.44)', cotizacion: 'Cotización',
  licitacion: 'Licitación Pública', competitiva: 'Compra Competitiva', art54: 'Art. 54 LCE',
  convenio: 'Convenio/Tratado', arrendamiento: 'Arrendamiento', donacion: 'Donación',
  'entre-publicas': 'Entre Entidades',
  direct: 'Directa', open: 'Abierta', selective: 'Selectiva', limited: 'Limitada',
}

function normalizeMunicipio(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const num = Number.parseInt(full, 16)
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 }
}

function interpolateColor(fromHex, toHex, ratio) {
  const clamped = Math.min(1, Math.max(0, ratio))
  const from = hexToRgb(fromHex)
  const to = hexToRgb(toHex)
  const r = Math.round(from.r + (to.r - from.r) * clamped)
  const g = Math.round(from.g + (to.g - from.g) * clamped)
  const b = Math.round(from.b + (to.b - from.b) * clamped)
  return `rgb(${r}, ${g}, ${b})`
}

function computeRisk(r) {
  if (r.sin_meta_ejecutada_con_gasto === 1) return 'sin_meta'
  if (r.sospechoso === 1) return 'sospechoso'
  if (r.adjudicacion_directa === 1) return 'sin_meta'
  if (r.oferente_unico === 1) return 'sospechoso'
  if (r.meta_baja_con_gasto === 1) return 'sospechoso'
  if (r.fraccionamiento === 1) return 'sobreejecucion'
  if (r.modificacion_excesiva === 1) return 'sobreejecucion'
  if (r.sobreejecucion_financiera === 1) return 'sobreejecucion'
  return undefined
}

// ─── Shared table columns ──────────────────────────────────────────────────────
const RISK_COLS = [
  { key: 'score_riesgo', header: 'Score', align: 'right' },
  { key: 'snip', header: 'SNIP' },
  { key: 'proyecto', header: 'Proyecto' },
  { key: 'municipio', header: 'Municipio' },
  { key: 'departamento', header: 'Departamento' },
  { key: 'alcalde_ganador', header: 'Alcalde' },
  { key: 'proveedor', header: 'Proveedor' },
  { key: 'ejercicio', header: 'Año', align: 'right' },
  { key: 'monto_adjudicado', header: 'Adjudicado', align: 'right', render: (r) => formatMoney(r.monto_adjudicado) },
  { key: 'monto_ejecutado', header: 'Ejecutado', align: 'right', render: (r) => formatMoney(r.monto_ejecutado) },
  { key: 'brecha_adjudicado_ejecutado', header: 'Brecha', align: 'right', render: (r) => formatMoney(r.brecha_adjudicado_ejecutado) },
  { key: 'ratio_meta_ejecucion', header: 'Ratio meta', align: 'right', render: (r) => formatPercent(r.ratio_meta_ejecucion) },
  {
    key: 'metodo_contratacion',
    header: 'Método',
    render: (r) =>
      r.metodo_contratacion ? (METHOD_LABEL[r.metodo_contratacion] ?? r.metodo_contratacion) : '—',
  },
  { key: 'n_oferentes', header: 'Oferentes', align: 'right', render: (r) => (r.n_oferentes != null ? r.n_oferentes : '—') },
  { key: 'fraccionamiento', header: 'Fracc.', align: 'right', render: (r) => (r.fraccionamiento === 1 ? '⚠ Sí' : '—') },
  { key: 'modificacion_excesiva', header: 'Mod. exc.', align: 'right', render: (r) => (r.modificacion_excesiva === 1 ? '⚠ Sí' : '—') },
]

// ─── Modal overlay ─────────────────────────────────────────────────────────────
function Modal({ title, subtitle, onClose, wide = false, children }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`relative bg-white dark:bg-d-card rounded-xl2 shadow-2xl border border-line dark:border-d-line flex flex-col max-h-[90vh] ${wide ? 'w-full max-w-5xl' : 'w-full max-w-lg'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line dark:border-d-line shrink-0">
          <div className="min-w-0">
            <h2
              className="text-base font-semibold text-ink-800 dark:text-d-text"
              style={{ fontFamily: 'Libre Baskerville' }}
            >
              {title}
            </h2>
            {subtitle ? <p className="text-xs text-ink-500 dark:text-d-muted mt-0.5">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1 rounded-lg hover:bg-canvas dark:hover:bg-d-canvas text-ink-400 hover:text-ink-700 dark:text-d-muted dark:hover:text-d-text transition-colors"
          >
            <X size={16} />
          </button>
        </header>
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  )
}

// ─── Alerts list modal (KPI + insight clicks) ──────────────────────────────────
function AlertsModal({ flagKey, preFiltered = false, title, subtitle, rows, onClose, onRowClick }) {
  const meta = FLAG_META[flagKey]
  const displayRows = preFiltered ? rows : rows.filter((r) => r[flagKey] === 1)
  return (
    <Modal title={title || meta?.label} subtitle={subtitle} onClose={onClose} wide>
      {meta ? (
        <div className="flex gap-3 px-5 py-4 bg-amber-50 dark:bg-amber-500/10 border-b border-line dark:border-d-line">
          <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <p className="text-sm text-ink-800 dark:text-d-text leading-relaxed">{meta.explanation}</p>
        </div>
      ) : null}
      <div className="p-4">
        {displayRows.length === 0 ? (
          <EmptyState title="Sin casos" message="No se encontraron proyectos con este indicador." />
        ) : (
          <DataTable
            columns={RISK_COLS}
            data={displayRows}
            defaultSort={{ key: 'score_riesgo', direction: 'desc' }}
            searchPlaceholder="Buscar SNIP, proyecto, municipio…"
            pageSize={20}
            onRowClick={onRowClick}
          />
        )}
      </div>
    </Modal>
  )
}

// ─── Project detail modal ──────────────────────────────────────────────────────
function ProjectModal({ row, onClose }) {
  const activeFlags = Object.keys(FLAG_META).filter((k) => row[k] === 1)
  const accentCls = {
    danger: 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300',
    warn: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300',
  }

  return (
    <Modal
      title={row.proyecto || 'Detalle de proyecto'}
      subtitle={[row.snip && `SNIP ${row.snip}`, row.municipio, row.ejercicio].filter(Boolean).join(' · ')}
      onClose={onClose}
    >
      <div className="p-5 space-y-5">
        {/* Score */}
        <div className="flex items-center gap-3">
          <span className="text-3xl font-bold num text-ink-800 dark:text-d-text">{row.score_riesgo ?? '—'}</span>
          <div>
            <div className="flex items-center gap-1.5">
              <div className="text-xs uppercase tracking-wide font-medium text-ink-500 dark:text-d-muted">Score de riesgo</div>
              <InfoTooltip text={
                'Suma ponderada de alertas activas (máx. 100):\n\n' +
                '• Gasto sin meta física     +30\n' +
                '• Adjudicación directa       +20\n' +
                '• Oferente único               +20\n' +
                '• Proyecto sospechoso      +20\n' +
                '• Fraccionamiento             +15\n' +
                '• Meta baja con gasto        +10\n' +
                '• Modificación excesiva     +10\n' +
                '• Sobreejecución financiera +10\n' +
                '• Año previo a elecciones   +5\n\n' +
                'Un proyecto puede acumular varios indicadores simultáneamente. El puntaje se recorta a 100.'
              } />
            </div>
            <div className="text-xs text-ink-500 dark:text-d-muted">Escala 0 – 100</div>
          </div>
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          {[
            ['Adjudicado', formatMoney(row.monto_adjudicado)],
            ['Ejecutado', formatMoney(row.monto_ejecutado)],
            ['Ratio meta física', formatPercent(row.ratio_meta_ejecucion)],
            ['Método contratación', METHOD_LABEL[row.metodo_contratacion] ?? row.metodo_contratacion ?? '—'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-canvas dark:bg-d-canvas p-3">
              <div className="text-xs text-ink-500 dark:text-d-muted uppercase tracking-wide">{label}</div>
              <div className="font-semibold num text-ink-800 dark:text-d-text mt-0.5">{value}</div>
            </div>
          ))}
        </div>

        {/* Active alerts */}
        <div>
          <h3 className="text-sm font-semibold text-ink-800 dark:text-d-text mb-3">
            {activeFlags.length === 0
              ? 'Sin alertas activas'
              : `${activeFlags.length} alerta${activeFlags.length !== 1 ? 's' : ''} activa${activeFlags.length !== 1 ? 's' : ''}`}
          </h3>
          {activeFlags.length === 0 ? (
            <p className="text-sm text-ink-500 dark:text-d-muted">Este proyecto no tiene alertas de riesgo activas.</p>
          ) : (
            <ul className="space-y-2">
              {activeFlags.map((k) => {
                const m = FLAG_META[k]
                const Icon = m?.Icon || AlertTriangle
                return (
                  <li key={k} className={`rounded-lg border p-3 ${accentCls[m?.accent] || accentCls.warn}`}>
                    <div className="flex items-start gap-2">
                      <Icon size={14} className="shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide">{m?.label || k}</div>
                        <p className="text-xs mt-1 leading-relaxed opacity-90">{m?.explanation}</p>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Context */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs border-t border-line dark:border-d-line pt-4">
          {[
            ['Alcalde', row.alcalde_ganador],
            ['Partido', row.partido],
            ['Proveedor', row.proveedor],
            ['Departamento', row.departamento],
            ['Ejercicio', row.ejercicio],
            ['Oferentes', row.n_oferentes != null ? row.n_oferentes : null],
          ]
            .filter(([, v]) => v != null && v !== '')
            .map(([k, v]) => (
              <div key={k} className="flex gap-1 min-w-0">
                <dt className="font-medium text-ink-500 dark:text-d-muted shrink-0">{k}:</dt>
                <dd className="text-ink-700 dark:text-d-text truncate">{v}</dd>
              </div>
            ))}
        </dl>
      </div>
    </Modal>
  )
}

// ─── Threshold sliders ─────────────────────────────────────────────────────────
function ThresholdSliders({ ejecucionMin, metaMax, onEjecucion, onMeta }) {
  // Local display state updates on every drag tick; parent is only notified on release
  const [localEj, setLocalEj] = useState(Math.round(ejecucionMin * 100))
  const [localMeta, setLocalMeta] = useState(Math.round(metaMax * 100))

  const commitEj = (val) => { setLocalEj(val); onEjecucion(val / 100) }
  const commitMeta = (val) => { setLocalMeta(val); onMeta(val / 100) }

  return (
    <div className="rounded-xl border border-line dark:border-d-line bg-canvas dark:bg-d-canvas px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mb-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-d-muted">
          Umbrales · Proyecto sospechoso
        </span>
        <span className="text-[10px] text-ink-400 dark:text-d-muted">
          Suelta el slider para recalcular. Sin comparación de fechas — solo ratios al momento de la descarga.
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
        {/* Condition 1 */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <span className="text-xs font-medium text-ink-700 dark:text-d-text">① % del contrato cobrado</span>
              <p className="text-[10px] text-ink-400 dark:text-d-muted mt-0.5">
                Monto ejecutado (pagado al proveedor) ≥ X% del adjudicado. Aplica sin importar la duración del proyecto: un contrato de 1 año donde se cobró el 95% pero se entregó el 20% es igualmente sospechoso.
              </p>
            </div>
            <span className="text-base font-bold tabular-nums text-accent shrink-0">{localEj}%</span>
          </div>
          <input
            type="range"
            min={50} max={99} step={1}
            value={localEj}
            onChange={(e) => setLocalEj(Number(e.target.value))}
            onMouseUp={(e) => commitEj(Number(e.target.value))}
            onPointerUp={(e) => commitEj(Number(e.currentTarget.value))}
            onTouchEnd={(e) => commitEj(Number(e.currentTarget.value))}
            className="w-full accent-accent h-1.5 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-ink-400 dark:text-d-muted">
            <span>50% · detecta más</span>
            <span>99% · más estricto</span>
          </div>
        </div>

        {/* Condition 2 */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <span className="text-xs font-medium text-ink-700 dark:text-d-text">② Meta física ejecutada</span>
              <p className="text-[10px] text-ink-400 dark:text-d-muted mt-0.5">
                Avance físico registrado {'<'} Y% de la meta comprometida. Ejemplo: se construyó menos del 50% de los metros de camino prometidos, aunque ya se cobró casi todo el contrato.
              </p>
            </div>
            <span className="text-base font-bold tabular-nums text-accent shrink-0">{localMeta}%</span>
          </div>
          <input
            type="range"
            min={5} max={80} step={1}
            value={localMeta}
            onChange={(e) => setLocalMeta(Number(e.target.value))}
            onMouseUp={(e) => commitMeta(Number(e.target.value))}
            onPointerUp={(e) => commitMeta(Number(e.currentTarget.value))}
            onTouchEnd={(e) => commitMeta(Number(e.currentTarget.value))}
            className="w-full accent-accent h-1.5 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-ink-400 dark:text-d-muted">
            <span>5% · más estricto</span>
            <span>80% · detecta más</span>
          </div>
        </div>
      </div>

      <p className="mt-4 text-[10px] text-ink-400 dark:text-d-muted border-t border-line dark:border-d-line pt-3">
        <span className="font-medium text-ink-500 dark:text-d-muted">③ Monto adjudicado {'>'} Q0</span>
        {' '}— condición fija, excluye proyectos sin datos de adjudicación en GuateCompras.
      </p>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function TabProyectosSospechosos({ filters }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [riskView, setRiskView] = useState('num')
  const [colorFilter, setColorFilter] = useState(null)
  const [kpiModal, setKpiModal] = useState(null)       // { flagKey, title }
  const [insightModal, setInsightModal] = useState(null) // { flagKey, filterFn?, title, entityKey?, entityValue? }
  const [projectModal, setProjectModal] = useState(null)  // row
  const [mapMunicipioModal, setMapMunicipioModal] = useState(null) // { title, subtitle, rows, flagKey }

  // Committed threshold values — only update on slider release, triggering a single fetch
  const [ejecucionMin, setEjecucionMin] = useState(0.95)
  const [metaMax, setMetaMax] = useState(0.50)
  const [geoJson, setGeoJson] = useState(null)
  const [geoLoading, setGeoLoading] = useState(true)
  const [geoError, setGeoError] = useState(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getProyectosSospechosos(filters, { ejecucionMin, metaMax })
      .then((d) => { if (active) setData(d) })
      .catch((err) => { if (active) setError(err?.message || 'Error al cargar datos') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [filters, ejecucionMin, metaMax])

  useEffect(() => {
    let active = true
    fetch('/gua.json')
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`No se pudo cargar gua.json (${res.status})`)
        }
        return res.json()
      })
      .then((json) => {
        if (active) setGeoJson(json)
      })
      .catch((err) => {
        if (active) setGeoError(err?.message || 'Error al cargar el mapa de municipios')
      })
      .finally(() => {
        if (active) setGeoLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const insights = data?.insights || {}

  const allRows = useMemo(
    () => (data?.tabla || []).map((r) => ({ ...r, _risk: computeRisk(r) })),
    [data]
  )

  const tableRows = useMemo(
    () => (colorFilter ? allRows.filter((r) => r._risk === colorFilter) : allRows),
    [allRows, colorFilter]
  )

  const modalRows = useMemo(() => {
    if (!insightModal) return []
    const { flagKey, filterFn, entityKey, entityValue } = insightModal
    if (filterFn) return allRows.filter(filterFn)
    return allRows.filter((r) => r[flagKey] === 1 && (!entityKey || r[entityKey] === entityValue))
  }, [allRows, insightModal])

  const openMapMunicipioModal = ({ mapTitle, flagKey, municipio, departamento, codmun }) => {
    const muniKey = normalizeMunicipio(municipio)
    const rows = allRows.filter((r) => {
      const sameMunicipio = normalizeMunicipio(r.municipio) === muniKey
      if (!sameMunicipio) return false
      return flagKey ? r[flagKey] === 1 : true
    })

    setMapMunicipioModal({
      title: `${mapTitle} · ${municipio || 'Municipio'}`,
      subtitle: [departamento, codmun ? `CODMUN ${codmun}` : null].filter(Boolean).join(' · '),
      rows,
      flagKey,
    })
  }

  if (loading) return <LoadingSpinner label="Cargando análisis de riesgo…" />
  if (error) return <EmptyState icon={AlertTriangle} title="No se pudo cargar la información" message={error} />
  if (!data) return null

  // ── Insight items ────────────────────────────────────────────────────────────
  const insightItems = [
    insights.top_alcalde_sos && {
      label: 'Alcalde con más proyectos sospechosos',
      value: (
        <>
          <strong>{insights.top_alcalde_sos.alcalde_ganador}</strong>
          {insights.top_alcalde_sos.partido ? ` (${insights.top_alcalde_sos.partido})` : ''} —{' '}
          {formatNumber(insights.top_alcalde_sos.casos)} casos · {formatPercent(insights.top_alcalde_sos.ratio)} de su cartera.
        </>
      ),
      flagKey: 'sospechoso',
      entityKey: 'alcalde_ganador',
      entityValue: insights.top_alcalde_sos.alcalde_ganador,
    },
    insights.top_municipio_sos && {
      label: 'Municipio con más proyectos sospechosos',
      value: (
        <>
          <strong>{insights.top_municipio_sos.municipio}</strong> —{' '}
          {formatNumber(insights.top_municipio_sos.casos)} casos ({formatPercent(insights.top_municipio_sos.ratio)}).
        </>
      ),
      flagKey: 'sospechoso',
      entityKey: 'municipio',
      entityValue: insights.top_municipio_sos.municipio,
    },
    insights.top_proveedor_sos && {
      label: 'Proveedor con más proyectos sospechosos',
      value: (
        <>
          <strong>{insights.top_proveedor_sos.proveedor}</strong> —{' '}
          {formatNumber(insights.top_proveedor_sos.casos)} proyectos ({formatPercent(insights.top_proveedor_sos.ratio)}).
        </>
      ),
      flagKey: 'sospechoso',
      entityKey: 'proveedor',
      entityValue: insights.top_proveedor_sos.proveedor,
    },
    insights.top_municipio_meta0 && {
      label: 'Municipio con más "gasto sin meta"',
      value: (
        <>
          <strong>{insights.top_municipio_meta0.municipio}</strong> —{' '}
          {formatNumber(insights.top_municipio_meta0.casos)} ({formatPercent(insights.top_municipio_meta0.ratio)}).
        </>
      ),
      flagKey: 'sin_meta_ejecutada_con_gasto',
      entityKey: 'municipio',
      entityValue: insights.top_municipio_meta0.municipio,
    },
    insights.top_alcalde_meta0 && {
      label: 'Alcalde con más "gasto sin meta"',
      value: (
        <>
          <strong>{insights.top_alcalde_meta0.alcalde_ganador}</strong>
          {insights.top_alcalde_meta0.partido ? ` (${insights.top_alcalde_meta0.partido})` : ''} —{' '}
          {formatNumber(insights.top_alcalde_meta0.casos)} casos.
        </>
      ),
      flagKey: 'sin_meta_ejecutada_con_gasto',
      entityKey: 'alcalde_ganador',
      entityValue: insights.top_alcalde_meta0.alcalde_ganador,
    },
    insights.top_municipio_fracc && {
      label: 'Municipio con más fraccionamiento de contratos',
      value: (
        <>
          <strong>{insights.top_municipio_fracc.municipio}</strong> —{' '}
          {formatNumber(insights.top_municipio_fracc.casos)} grupos con posible fraccionamiento (
          {formatPercent(insights.top_municipio_fracc.ratio)}).
        </>
      ),
      flagKey: 'fraccionamiento',
      entityKey: 'municipio',
      entityValue: insights.top_municipio_fracc.municipio,
    },
    insights.top_proveedor_fracc && {
      label: 'Proveedor con más fraccionamiento de contratos',
      value: (
        <>
          <strong>{insights.top_proveedor_fracc.proveedor}</strong> —{' '}
          {formatNumber(insights.top_proveedor_fracc.casos)} contratos en grupos sospechosos (
          {formatPercent(insights.top_proveedor_fracc.ratio)}).
        </>
      ),
      flagKey: 'fraccionamiento',
      entityKey: 'proveedor',
      entityValue: insights.top_proveedor_fracc.proveedor,
    },
    insights.top_municipio_mod && {
      label: 'Municipio con más modificaciones excesivas de contrato',
      value: (
        <>
          <strong>{insights.top_municipio_mod.municipio}</strong> —{' '}
          {formatNumber(insights.top_municipio_mod.casos)} proyectos con aumento {'>'}20 % sobre el monto inicial (
          {formatPercent(insights.top_municipio_mod.ratio)}).
        </>
      ),
      flagKey: 'modificacion_excesiva',
      entityKey: 'municipio',
      entityValue: insights.top_municipio_mod.municipio,
    },
    insights.top_municipio_adj && {
      label: 'Municipio con más adjudicaciones directas (sin licitación)',
      value: (
        <>
          <strong>{insights.top_municipio_adj.municipio}</strong> —{' '}
          {formatNumber(insights.top_municipio_adj.casos)} contratos adjudicados directamente (
          {formatPercent(insights.top_municipio_adj.ratio)} de sus proyectos).
        </>
      ),
      flagKey: 'adjudicacion_directa',
      entityKey: 'municipio',
      entityValue: insights.top_municipio_adj.municipio,
    },
    insights.top_proveedor_adj && {
      label: 'Proveedor con más adjudicaciones directas',
      value: (
        <>
          <strong>{insights.top_proveedor_adj.proveedor}</strong> —{' '}
          {formatNumber(insights.top_proveedor_adj.casos)} contratos sin proceso competitivo (
          {formatPercent(insights.top_proveedor_adj.ratio)}).
        </>
      ),
      flagKey: 'adjudicacion_directa',
      entityKey: 'proveedor',
      entityValue: insights.top_proveedor_adj.proveedor,
    },
    insights.top_municipio_of1 && {
      label: 'Municipio con más procesos con un solo oferente',
      value: (
        <>
          <strong>{insights.top_municipio_of1.municipio}</strong> —{' '}
          {formatNumber(insights.top_municipio_of1.casos)} licitaciones con un único participante (
          {formatPercent(insights.top_municipio_of1.ratio)}).
        </>
      ),
      flagKey: 'oferente_unico',
      entityKey: 'municipio',
      entityValue: insights.top_municipio_of1.municipio,
    },
    {
      label: 'Proyectos con triple alerta original',
      value: (
        <>
          <strong className="num">{formatNumber(insights.proyectos_tres_flags)}</strong> proyectos cumplen las tres
          condiciones originales (sospechoso + sin meta con gasto + sobreejecución).
        </>
      ),
      flagKey: 'sospechoso',
      filterFn: (r) =>
        r.sospechoso === 1 && r.sin_meta_ejecutada_con_gasto === 1 && r.sobreejecucion_financiera === 1,
      title: 'Proyectos con triple alerta',
    },
  ].filter(Boolean)

  return (
    <div className="space-y-6">
      {/* ── Hallazgos ─────────────────────────────────────────────────────────── */}
      <section className="rounded-xl2 border border-line dark:border-d-line bg-white dark:bg-d-card shadow-card">
        <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-line dark:border-d-line">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft dark:bg-accent/15 text-accent shrink-0">
              <Sparkles size={18} />
            </span>
            <div>
              <h3
                className="text-base font-semibold text-ink-800 dark:text-d-text"
                style={{ fontFamily: 'Libre Baskerville' }}
              >
                Hallazgos · Proyectos con alertas
              </h3>
              <p className="text-xs text-ink-500 dark:text-d-muted mt-0.5">
                Indicadores de riesgo agregados. Haz clic en cada hallazgo para ver los casos.
              </p>
            </div>
          </div>
          <InfoTooltip text="Resumen automático de las observaciones más relevantes según los filtros aplicados. Haz clic en cualquier hallazgo para explorar los proyectos relacionados." />
        </header>
        <ul className="divide-y divide-line dark:divide-d-line">
          {insightItems.length === 0 ? (
            <li className="px-5 py-4 text-sm text-ink-500 dark:text-d-muted">
              No se identificaron hallazgos con los filtros actuales.
            </li>
          ) : (
            insightItems.map((item, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() =>
                    setInsightModal({
                      flagKey: item.flagKey,
                      filterFn: item.filterFn,
                      title: item.title || item.label,
                      entityKey: item.entityKey,
                      entityValue: item.entityValue,
                    })
                  }
                  className="w-full px-5 py-3 flex items-start gap-3 text-left hover:bg-canvas/60 dark:hover:bg-d-canvas/40 transition-colors group"
                >
                  <span className="mt-2 inline-block h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-d-muted group-hover:text-accent transition-colors">
                      {item.label}
                    </div>
                    <div className="text-sm text-ink-800 dark:text-d-text mt-0.5 break-words">{item.value}</div>
                  </div>
                  <span className="shrink-0 mt-1 text-xs text-ink-400 dark:text-d-muted group-hover:text-accent transition-colors">
                    Ver →
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      {/* ── KPI row 1: ejecución física/financiera ─────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Sospechosos por baja ejecución"
          value={formatPercent(insights.pct_sospechosos)}
          icon={AlertTriangle}
          accent="danger"
          description={`Gasto ≥${Math.round(ejecucionMin * 100)}% del adjudicado y meta física <${Math.round(metaMax * 100)}%.`}
          onClick={() => setKpiModal({ flagKey: 'sospechoso', title: 'Proyectos sospechosos' })}
        />
        <KpiCard
          label="Gasto sin meta"
          value={formatPercent(insights.pct_meta0_gasto)}
          icon={TrendingDown}
          accent="warn"
          description="Proyectos con gasto reportado y meta física = 0."
          onClick={() => setKpiModal({ flagKey: 'sin_meta_ejecutada_con_gasto', title: 'Proyectos con gasto sin meta' })}
        />
        <KpiCard
          label="Meta baja con gasto"
          value={formatPercent(insights.pct_meta_baja)}
          icon={TrendingDown}
          accent="warn"
          description="Meta física <10% con gasto significativo (>Q50k)."
          onClick={() => setKpiModal({ flagKey: 'meta_baja_con_gasto', title: 'Proyectos con meta baja y gasto significativo' })}
        />
        <KpiCard
          label="Sobreejecución"
          value={formatPercent(insights.pct_sobreejecucion)}
          icon={TrendingUp}
          accent="warn"
          description="Proyectos con gasto mayor al monto adjudicado."
          onClick={() => setKpiModal({ flagKey: 'sobreejecucion_financiera', title: 'Proyectos con sobreejecución financiera' })}
        />
      </div>

      {/* ── KPI row 2: indicadores de proceso de contratación ─────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Adjudicación directa"
          value={formatPercent(insights.pct_adjudicacion_directa)}
          icon={Gavel}
          accent="danger"
          description={`Contratos sin proceso competitivo (método "direct" OCDS).${insights.cobertura_ocds != null ? ` Cobertura OCDS: ${Math.round(insights.cobertura_ocds * 100)}%.` : ' Sin datos OCDS aún.'}`}
          onClick={() => setKpiModal({ flagKey: 'adjudicacion_directa', title: 'Contratos adjudicados directamente' })}
        />
        <KpiCard
          label="Oferente único"
          value={formatPercent(insights.pct_oferente_unico)}
          icon={Users}
          accent="danger"
          description="Licitaciones supuestamente competitivas con un solo participante."
          onClick={() => setKpiModal({ flagKey: 'oferente_unico', title: 'Licitaciones con oferente único' })}
        />
        <KpiCard
          label="Fraccionamiento"
          value={formatPercent(insights.pct_fraccionamiento)}
          icon={Scissors}
          accent="danger"
          description="Contratos que en conjunto superan Q900k pero individualmente no — patrón para evitar licitación."
          onClick={() => setKpiModal({ flagKey: 'fraccionamiento', title: 'Contratos con posible fraccionamiento' })}
        />
        <KpiCard
          label="Modificación excesiva"
          value={formatPercent(insights.pct_modificacion_excesiva)}
          icon={Wrench}
          accent="warn"
          description="Presupuesto aumentado >20% respecto al monto inicial aprobado."
          onClick={() => setKpiModal({ flagKey: 'modificacion_excesiva', title: 'Contratos con modificación excesiva' })}
        />
      </div>

      {/* ── Threshold sliders ─────────────────────────────────────────────────── */}
      <ThresholdSliders
        ejecucionMin={ejecucionMin}
        metaMax={metaMax}
        onEjecucion={setEjecucionMin}
        onMeta={setMetaMax}
      />

      {/* ── Risk rankings ─────────────────────────────────────────────────────── */}
      <SectionCard
        title="Ranking de municipios por riesgo"
        subtitle="4 mapas coropléticos de riesgo por municipio (número o porcentaje)."
        tooltip="Pasa el cursor sobre un municipio para ver sus indicadores y su codmun."
        actions={
          <div className="inline-flex items-center rounded-lg border border-line dark:border-d-line bg-canvas dark:bg-d-canvas p-0.5">
            <button
              type="button"
              onClick={() => setRiskView('num')}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${riskView === 'num' ? 'bg-white dark:bg-d-card text-accent shadow-card' : 'text-ink-500 dark:text-d-muted hover:text-ink-800 dark:hover:text-d-text'}`}
            >
              Número
            </button>
            <button
              type="button"
              onClick={() => setRiskView('pct')}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${riskView === 'pct' ? 'bg-white dark:bg-d-card text-accent shadow-card' : 'text-ink-500 dark:text-d-muted hover:text-ink-800 dark:hover:text-d-text'}`}
            >
              Porcentaje
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div className="min-w-0">
            <MunicipalRiskMap
              title="Proyectos sospechosos"
              data={data.map_sospechosos}
              flagKey="sospechoso"
              geoJson={geoJson}
              geoLoading={geoLoading}
              geoError={geoError}
              view={riskView}
              fromColor="#FEE2E2"
              toColor="#DC2626"
              onMunicipioClick={openMapMunicipioModal}
              emptyNote={`Ningún proyecto cumple las tres condiciones simultáneamente: ① gasto ≥${Math.round(ejecucionMin * 100)}% del adjudicado · ② meta física <${Math.round(metaMax * 100)}% · ③ monto adjudicado > Q0. Esto es normal en períodos recientes donde los proyectos aún están en ejecución. Baja el umbral de ejecución o sube el de meta para ampliar la detección.`}
            />
          </div>
          <div className="min-w-0">
            <MunicipalRiskMap
              title="Proveedores sospechosos"
              data={data.map_proveedores_sos}
              flagKey="sospechoso"
              geoJson={geoJson}
              geoLoading={geoLoading}
              geoError={geoError}
              view={riskView}
              fromColor="#FED7AA"
              toColor="#EA580C"
              onMunicipioClick={openMapMunicipioModal}
              emptyNote="Derivado de proyectos sospechosos: si no hay casos en el período seleccionado, este mapa no mostrará municipios."
            />
          </div>
          <div className="min-w-0">
            <MunicipalRiskMap
              title="Gasto sin meta"
              data={data.map_meta0_gasto}
              flagKey="sin_meta_ejecutada_con_gasto"
              geoJson={geoJson}
              geoLoading={geoLoading}
              geoError={geoError}
              view={riskView}
              fromColor="#FEF3C7"
              toColor="#D97706"
              onMunicipioClick={openMapMunicipioModal}
            />
          </div>
          <div className="min-w-0">
            <MunicipalRiskMap
              title="Fraccionamiento de contratos"
              data={data.map_fraccionamiento}
              flagKey="fraccionamiento"
              geoJson={geoJson}
              geoLoading={geoLoading}
              geoError={geoError}
              view={riskView}
              fromColor="#DDD6FE"
              toColor="#7C3AED"
              onMunicipioClick={openMapMunicipioModal}
            />
          </div>
        </div>
      </SectionCard>

      {/* ── Proyectos marcados ─────────────────────────────────────────────────── */}
      <SectionCard
        title="Proyectos marcados"
        subtitle="Lista de proyectos con al menos una alerta. Haz clic en una fila para ver el detalle completo."
        tooltip="Rojo intenso: sin meta con gasto · adjudicación directa. Rojo suave: sospechoso · oferente único · meta baja. Amarillo: sobreejecución · fraccionamiento · modificación excesiva."
        noPadding
      >
        {/* Color filter */}
        <div className="px-5 pt-4 pb-3 flex flex-wrap items-center gap-2 border-b border-line dark:border-d-line">
          <span className="text-xs font-medium text-ink-500 dark:text-d-muted uppercase tracking-wide mr-1">
            Filtrar:
          </span>
          <button
            type="button"
            onClick={() => setColorFilter(null)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              !colorFilter
                ? 'bg-ink-800 dark:bg-d-text text-white dark:text-d-card border-transparent'
                : 'border-line dark:border-d-line text-ink-600 dark:text-d-muted hover:border-accent hover:text-accent'
            }`}
          >
            Todos ({allRows.length})
          </button>
          {RISK_LEGEND.map((cat) => {
            const count = allRows.filter((r) => r._risk === cat.key).length
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => setColorFilter(colorFilter === cat.key ? null : cat.key)}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-full border transition-colors ${
                  colorFilter === cat.key
                    ? 'bg-ink-800 dark:bg-d-text text-white dark:text-d-card border-transparent'
                    : 'border-line dark:border-d-line text-ink-600 dark:text-d-muted hover:border-accent hover:text-accent'
                }`}
              >
                <span className={`inline-block w-2 h-2 rounded-full ${cat.dot}`} />
                {cat.label} ({count})
              </button>
            )
          })}
        </div>

        {/* Legend */}
        <div className="px-5 py-2.5 flex flex-wrap gap-5 bg-canvas/40 dark:bg-d-canvas/40 border-b border-line dark:border-d-line">
          {RISK_LEGEND.map((cat) => (
            <div key={cat.key} className="flex items-center gap-2 text-xs text-ink-600 dark:text-d-muted">
              <span className={`inline-block w-3 h-3 rounded-sm border border-black/10 ${cat.row}`} />
              <span className="font-medium text-ink-700 dark:text-d-text">{cat.label}:</span>
              <span>{cat.desc}</span>
            </div>
          ))}
        </div>

        {tableRows.length ? (
          <DataTable
            columns={RISK_COLS}
            data={tableRows}
            defaultSort={{ key: 'score_riesgo', direction: 'desc' }}
            searchPlaceholder="Buscar SNIP, proyecto, municipio, alcalde…"
            onRowClick={(row) => setProjectModal(row)}
          />
        ) : (
          <div className="p-5">
            <EmptyState title="Sin proyectos marcados" message="No se encontraron alertas para los filtros aplicados." />
          </div>
        )}
      </SectionCard>

      {/* ── Modals ────────────────────────────────────────────────────────────── */}
      {kpiModal && (
        <AlertsModal
          flagKey={kpiModal.flagKey}
          title={kpiModal.title}
          rows={allRows}
          onClose={() => setKpiModal(null)}
          onRowClick={(row) => {
            setKpiModal(null)
            setProjectModal(row)
          }}
        />
      )}
      {insightModal && (
        <AlertsModal
          flagKey={insightModal.flagKey}
          preFiltered
          title={insightModal.title}
          subtitle={insightModal.entityValue ? `Filtrado a: ${insightModal.entityValue}` : undefined}
          rows={modalRows}
          onClose={() => setInsightModal(null)}
          onRowClick={(row) => {
            setInsightModal(null)
            setProjectModal(row)
          }}
        />
      )}
      {mapMunicipioModal && (
        <AlertsModal
          flagKey={mapMunicipioModal.flagKey}
          preFiltered
          title={mapMunicipioModal.title}
          subtitle={mapMunicipioModal.subtitle}
          rows={mapMunicipioModal.rows}
          onClose={() => setMapMunicipioModal(null)}
          onRowClick={(row) => {
            setMapMunicipioModal(null)
            setProjectModal(row)
          }}
        />
      )}
      {projectModal && <ProjectModal row={projectModal} onClose={() => setProjectModal(null)} />}
    </div>
  )
}

// ─── Municipal risk map ────────────────────────────────────────────────────────
function MunicipalRiskMap({
  title,
  data,
  flagKey,
  view,
  fromColor,
  toColor,
  geoJson,
  geoLoading,
  geoError,
  onMunicipioClick,
  emptyNote,
}) {
  const dataKey = view === 'pct' ? 'pct' : 'num'

  const rows = useMemo(
    () =>
      [...(data || [])]
        .filter((r) => r && r.municipio)
        .map((r) => ({
          ...r,
          num: Number(r.num) || 0,
          pct: Number(r.pct) || 0,
          total: Number(r.total) || 0,
        })),
    [data]
  )

  const statsByMunicipio = useMemo(() => {
    const map = new Map()
    for (const row of rows) {
      map.set(normalizeMunicipio(row.municipio), row)
    }
    return map
  }, [rows])

  const values = useMemo(
    () =>
      rows
        .map((r) => r[dataKey])
        .filter((v) => Number.isFinite(v) && v > 0),
    [rows, dataKey]
  )
  const maxValue = values.length ? Math.max(...values) : 0
  const mapBounds = useMemo(() => (geoJson ? L.geoJSON(geoJson).getBounds() : null), [geoJson])

  if (rows.length === 0) {
    return (
      <div>
        <h4 className="text-sm font-semibold text-ink-800 dark:text-d-text mb-2" style={{ fontFamily: 'Inter' }}>
          {title}
        </h4>
        {emptyNote ? (
          <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            {emptyNote}
          </div>
        ) : (
          <EmptyState title="Sin datos" message="No hay registros en esta categoría." />
        )}
      </div>
    )
  }

  if (geoLoading) {
    return (
      <div>
        <h4 className="text-sm font-semibold text-ink-800 dark:text-d-text mb-2" style={{ fontFamily: 'Inter' }}>
          {title}
        </h4>
        <LoadingSpinner label="Cargando mapa…" />
      </div>
    )
  }

  if (geoError || !geoJson || !mapBounds) {
    return (
      <div>
        <h4 className="text-sm font-semibold text-ink-800 dark:text-d-text mb-2" style={{ fontFamily: 'Inter' }}>
          {title}
        </h4>
        <EmptyState title="Mapa no disponible" message={geoError || 'No se pudo preparar la geometría de municipios.'} />
      </div>
    )
  }

  const formatVal = (v) => (view === 'pct' ? formatPercent(v) : formatNumber(v))
  const labelValue = view === 'pct' ? 'Porcentaje de proyectos' : 'Proyectos marcados'

  const styleFeature = (feature) => {
    const muniKey = normalizeMunicipio(feature?.properties?.municipio)
    const stat = statsByMunicipio.get(muniKey)
    const value = Number(stat?.[dataKey]) || 0
    const ratio = maxValue > 0 ? value / maxValue : 0
    return {
      fillColor: value > 0 ? interpolateColor(fromColor, toColor, ratio) : '#E5E7EB',
      fillOpacity: value > 0 ? 0.9 : 0.35,
      color: '#334155',
      weight: 0.7,
      opacity: 0.8,
      className: onMunicipioClick ? 'cursor-pointer' : undefined,
    }
  }

  const onEachFeature = (feature, layer) => {
    const props = feature?.properties || {}
    const muniKey = normalizeMunicipio(props.municipio)
    const stat = statsByMunicipio.get(muniKey)
    const value = Number(stat?.[dataKey]) || 0
    const tooltip = [
      `<strong>${props.municipio || 'Municipio'}</strong>`,
      `Departamento: ${props.departamento || '—'}`,
      `Codmun: ${props.codmun || '—'}`,
      `${labelValue}: ${value > 0 ? formatVal(value) : 'Sin datos'}`,
      `Total proyectos: ${stat?.total ? formatNumber(stat.total) : '—'}`,
    ].join('<br/>')

    layer.bindTooltip(tooltip, {
      sticky: true,
      direction: 'auto',
      opacity: 0.95,
    })
    layer.on({
      mouseover: () => {
        layer.setStyle({ weight: 1.8, color: '#0F172A', opacity: 1 })
        layer.openTooltip()
      },
      mouseout: () => {
        layer.setStyle({ weight: 0.7, color: '#334155', opacity: 0.8 })
      },
      click: () => {
        if (!onMunicipioClick) return
        onMunicipioClick({
          mapTitle: title,
          flagKey,
          municipio: props.municipio,
          departamento: props.departamento,
          codmun: props.codmun,
        })
      },
    })
  }

  return (
    <div>
      <h4 className="text-sm font-semibold text-ink-800 dark:text-d-text mb-3" style={{ fontFamily: 'Inter' }}>
        {title}
      </h4>
      <div className="rounded-lg border border-line dark:border-d-line overflow-hidden">
        <MapContainer
          bounds={mapBounds}
          boundsOptions={{ padding: [24, 24] }}
          maxBounds={mapBounds.pad(0.25)}
          maxBoundsViscosity={1}
          scrollWheelZoom={false}
          zoomControl={false}
          attributionControl={false}
          style={{ width: '100%', height: 530 }}
          className="bg-slate-100 dark:bg-slate-900"
          whenReady={(evt) => {
            setTimeout(() => {
              evt.target.invalidateSize()
              evt.target.fitBounds(mapBounds, { padding: [24, 24] })
            }, 0)
          }}
        >
          <GeoJSON
            key={`${title}-${view}-${maxValue}-${rows.length}`}
            data={geoJson}
            style={styleFeature}
            onEachFeature={onEachFeature}
          />
        </MapContainer>
      </div>
      <div className="mt-3 px-1">
        <div className="flex items-center gap-2">
          <span className="h-4 w-4 shrink-0 rounded-full border border-slate-400/60 bg-slate-200 dark:bg-slate-700" />
          <div
            className="relative h-4 flex-1 rounded-full border border-slate-400/50 overflow-hidden"
            style={{ background: `linear-gradient(90deg, #E5E7EB 0%, ${fromColor} 25%, ${toColor} 100%)` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-ink-500 dark:text-d-muted">
          <span>Bajo</span>
          <span>Termómetro de riesgo</span>
          <span>Alto</span>
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-ink-500 dark:text-d-muted">
        <span>Sin datos</span>
        <span>Escala: 0 → {maxValue > 0 ? formatVal(maxValue) : view === 'pct' ? '0%' : '0'}</span>
      </div>
    </div>
  )
}

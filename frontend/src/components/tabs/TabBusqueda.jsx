import { useState } from 'react'
import {
  AlertTriangle,
  Building2,
  FileSearch,
  Search,
  User,
  Loader2,
} from 'lucide-react'
import { getBusqueda } from '../../api/client.js'
import { formatMoney } from '../../utils/format.js'
import { useTheme } from '../../contexts/ThemeContext.jsx'
import SectionCard from '../common/SectionCard.jsx'
import EmptyState from '../common/EmptyState.jsx'

// ─── Variable definitions ────────────────────────────────────────────────────

const VARIABLES = {
  proyectos: [
    {
      id: 'score_riesgo',
      label: 'Score de riesgo compuesto',
      descripcion:
        'Proyectos con múltiples señales de riesgo activas. Suma ponderada de todos los indicadores de irregularidad (0–100). Prioriza los casos más complejos.',
      nivel: 'critical',
      umbral: 'score ≥ 40',
    },
    {
      id: 'adjudicacion_directa',
      label: 'Adjudicación directa sin concurso',
      descripcion:
        'Contrato otorgado sin proceso competitivo (método "direct" en OCDS). Señal de alerta cuando el monto supera el umbral de cotización pública.',
      nivel: 'high',
      umbral: 'método = direct',
    },
    {
      id: 'oferente_unico',
      label: 'Un solo oferente en licitación',
      descripcion:
        'Solo un proveedor participó en una licitación formalmente abierta. Puede indicar que las bases fueron redactadas para favorecer a un proveedor específico.',
      nivel: 'high',
      umbral: 'n_oferentes = 1 (no directa)',
    },
    {
      id: 'fraccionamiento',
      label: 'Fraccionamiento de contratos',
      descripcion:
        'Mismo proveedor, municipio y año: suma de contratos supera Q900 K pero ninguno individualmente. Patrón clásico para evadir licitación pública obligatoria.',
      nivel: 'high',
      umbral: 'suma > Q900 K, max individual < Q900 K, ≥3 contratos',
    },
    {
      id: 'sospechoso',
      label: 'Alta ejecución financiera, baja meta física',
      descripcion:
        'Más del 95 % del dinero fue ejecutado pero menos del 50 % de la obra fue realizada. Patrón clásico de posible desvío: el dinero sale pero la obra no aparece.',
      nivel: 'critical',
      umbral: 'ejecución financiera > 95 %, meta física < 50 %',
    },
    {
      id: 'sin_meta_ejecutada_con_gasto',
      label: 'Gasto registrado sin ejecución física',
      descripcion:
        'Proyecto con gasto confirmado pero meta física en cero. No hay evidencia alguna de que se haya construido o entregado algo.',
      nivel: 'critical',
      umbral: 'meta_ejecutada = 0, monto_ejecutado > 0',
    },
    {
      id: 'sobreejecucion_financiera',
      label: 'Sobreejecutado vs. monto adjudicado',
      descripcion:
        'El monto gastado supera al monto adjudicado. Puede indicar pagos no autorizados, ampliaciones irregulares o errores contables graves.',
      nivel: 'medium',
      umbral: 'monto_ejecutado > monto_adjudicado',
    },
    {
      id: 'modificacion_excesiva',
      label: 'Modificación presupuestaria > 20 %',
      descripcion:
        'El presupuesto vigente supera en más del 20 % al monto inicial aprobado. Patrón: se gana la licitación a precio bajo y luego se infla el contrato con addendas.',
      nivel: 'medium',
      umbral: '(monto_vigente − monto_inicial) / monto_inicial > 20 %',
    },
  ],
  proveedores: [
    {
      id: 'alta_directa',
      label: 'Alta tasa de adjudicaciones directas',
      descripcion:
        'Más del 60 % de sus contratos fueron adjudicados directamente, sin proceso competitivo. Puede indicar relaciones preferenciales con unidades ejecutoras.',
      nivel: 'high',
      umbral: '% contratos directos > 60 %, mínimo 3 contratos',
    },
    {
      id: 'dominio_municipal',
      label: 'Dominio absoluto en un municipio',
      descripcion:
        'Más del 50 % de su facturación total proviene de un solo municipio. Señal de posible captura de mercado local o acuerdo con autoridades municipales.',
      nivel: 'high',
      umbral: '% monto en un municipio > 50 %',
    },
    {
      id: 'fraccionamiento_sistematico',
      label: 'Fraccionamiento sistemático',
      descripcion:
        'Proveedor presente en múltiples contratos marcados como fraccionamiento. Patrón recurrente de división artificial de contratos para evadir licitación.',
      nivel: 'critical',
      umbral: '≥ 2 contratos con bandera de fraccionamiento',
    },
    {
      id: 'alto_score_promedio',
      label: 'Score de riesgo promedio alto',
      descripcion:
        'El promedio del score de riesgo a través de todos sus contratos es superior a 30/100. Historial de adjudicaciones con múltiples señales de alerta.',
      nivel: 'high',
      umbral: 'avg(score_riesgo) ≥ 30, mínimo 3 contratos',
    },
  ],
  alcaldes: [
    {
      id: 'alta_tasa_sospechosos',
      label: 'Alta tasa de proyectos sospechosos',
      descripcion:
        'Más del 30 % de los proyectos ejecutados bajo su administración tienen la bandera de sospechoso activa: alta ejecución financiera con baja meta física.',
      nivel: 'critical',
      umbral: '% proyectos sospechosos > 30 %, mínimo 5 proyectos',
    },
    {
      id: 'concentracion_proveedor',
      label: 'Concentración extrema en un proveedor',
      descripcion:
        'Más del 50 % del presupuesto adjudicado durante su mandato fue otorgado a un único proveedor. Alta dependencia o posible colusión.',
      nivel: 'critical',
      umbral: '% monto a un proveedor > 50 %',
    },
    {
      id: 'alta_adjudicacion_directa',
      label: 'Alta tasa de adjudicaciones directas',
      descripcion:
        'Más del 50 % de los contratos bajo su gestión fueron adjudicados directamente, sin proceso competitivo. Omisión sistemática de controles de mercado.',
      nivel: 'high',
      umbral: '% contratos directos > 50 %, mínimo 5 contratos',
    },
  ],
}

// ─── TIPO config ─────────────────────────────────────────────────────────────

const TIPOS = [
  {
    id: 'proyectos',
    label: 'Proyectos / SNIPs',
    descripcion: 'Buscar proyectos con señales de irregularidad en su ejecución o contratación.',
    icon: FileSearch,
  },
  {
    id: 'proveedores',
    label: 'Proveedores',
    descripcion: 'Identificar empresas o personas con patrones sistemáticos de riesgo.',
    icon: Building2,
  },
  {
    id: 'alcaldes',
    label: 'Alcaldes',
    descripcion: 'Detectar autoridades municipales con gestión presupuestaria irregular.',
    icon: User,
  },
]

// ─── Risk level badges ────────────────────────────────────────────────────────

const NIVEL_STYLES = {
  critical: {
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    border: 'border-red-300 dark:border-red-800',
    bg: 'bg-red-50 dark:bg-red-900/10',
    label: 'Crítico',
  },
  high: {
    badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    border: 'border-orange-300 dark:border-orange-800',
    bg: 'bg-orange-50 dark:bg-orange-900/10',
    label: 'Alto',
  },
  medium: {
    badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    border: 'border-yellow-300 dark:border-yellow-800',
    bg: 'bg-yellow-50 dark:bg-yellow-900/10',
    label: 'Medio',
  },
}

// ─── Result cards ─────────────────────────────────────────────────────────────

function ProyectoCard({ item, index }) {
  return (
    <div className="flex gap-4 p-4 rounded-lg border border-line dark:border-d-line bg-white dark:bg-d-card">
      <div className="shrink-0 w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-sm font-semibold text-ink-500 dark:text-d-muted">
        {index + 1}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <span className="text-xs font-mono text-ink-400 dark:text-d-muted">SNIP {item.snip}</span>
            <h4 className="text-sm font-semibold text-ink-800 dark:text-d-text leading-snug">
              {item.proyecto || '—'}
            </h4>
          </div>
          {item.score_riesgo > 0 && (
            <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium">
              Score {item.score_riesgo}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-500 dark:text-d-muted">
          {item.municipio && <span>{item.municipio}{item.departamento ? `, ${item.departamento}` : ''}</span>}
          {item.sector && <span>· {item.sector}</span>}
          {item.ejercicio && <span>· {item.ejercicio}</span>}
        </div>
        {item.proveedor && (
          <div className="text-xs text-ink-600 dark:text-d-text">
            Proveedor: <span className="font-medium">{item.proveedor}</span>
          </div>
        )}
        {item.monto_adjudicado != null && (
          <div className="text-xs text-ink-600 dark:text-d-text">
            Adjudicado: <span className="font-semibold">{formatMoney(item.monto_adjudicado)}</span>
            {item.monto_ejecutado != null && (
              <span className="ml-2 text-ink-400 dark:text-d-muted">
                · Ejecutado: {formatMoney(item.monto_ejecutado)}
              </span>
            )}
          </div>
        )}
        <div className="mt-2 text-xs text-ink-500 dark:text-d-muted bg-slate-50 dark:bg-slate-800/50 rounded px-3 py-2 border-l-2 border-orange-400 leading-relaxed">
          <span className="font-semibold text-orange-600 dark:text-orange-400">Razón: </span>
          {item.razon}
        </div>
      </div>
    </div>
  )
}

function ProveedorCard({ item, index }) {
  return (
    <div className="flex gap-4 p-4 rounded-lg border border-line dark:border-d-line bg-white dark:bg-d-card">
      <div className="shrink-0 w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-sm font-semibold text-ink-500 dark:text-d-muted">
        {index + 1}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <h4 className="text-sm font-semibold text-ink-800 dark:text-d-text leading-snug">
          {item.nombre || '—'}
        </h4>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-500 dark:text-d-muted">
          {item.municipio && <span>Municipio principal: {item.municipio}</span>}
          {item.total_contratos != null && <span>· {item.total_contratos} contratos</span>}
        </div>
        {item.monto_total != null && (
          <div className="text-xs text-ink-600 dark:text-d-text">
            Monto total adjudicado: <span className="font-semibold">{formatMoney(item.monto_total)}</span>
          </div>
        )}
        <div className="mt-2 text-xs text-ink-500 dark:text-d-muted bg-slate-50 dark:bg-slate-800/50 rounded px-3 py-2 border-l-2 border-orange-400 leading-relaxed">
          <span className="font-semibold text-orange-600 dark:text-orange-400">Razón: </span>
          {item.razon}
        </div>
      </div>
    </div>
  )
}

function AlcaldeCard({ item, index }) {
  return (
    <div className="flex gap-4 p-4 rounded-lg border border-line dark:border-d-line bg-white dark:bg-d-card">
      <div className="shrink-0 w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-sm font-semibold text-ink-500 dark:text-d-muted">
        {index + 1}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <h4 className="text-sm font-semibold text-ink-800 dark:text-d-text leading-snug">
          {item.nombre || '—'}
        </h4>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-500 dark:text-d-muted">
          {item.municipio && (
            <span>{item.municipio}{item.departamento ? `, ${item.departamento}` : ''}</span>
          )}
          {item.partido && item.partido !== '—' && <span>· {item.partido}</span>}
          {item.total_proyectos != null && <span>· {item.total_proyectos} proyectos</span>}
        </div>
        {item.monto_total != null && (
          <div className="text-xs text-ink-600 dark:text-d-text">
            Monto total: <span className="font-semibold">{formatMoney(item.monto_total)}</span>
          </div>
        )}
        <div className="mt-2 text-xs text-ink-500 dark:text-d-muted bg-slate-50 dark:bg-slate-800/50 rounded px-3 py-2 border-l-2 border-orange-400 leading-relaxed">
          <span className="font-semibold text-orange-600 dark:text-orange-400">Razón: </span>
          {item.razon}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TabBusqueda({ filters }) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const [tipo, setTipo] = useState('proyectos')
  const [variable, setVariable] = useState(null)
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [searchedLabel, setSearchedLabel] = useState('')

  const handleTipoChange = (newTipo) => {
    setTipo(newTipo)
    setVariable(null)
    setResults(null)
    setError(null)
  }

  const handleSearch = async () => {
    if (!variable) return
    const varMeta = VARIABLES[tipo].find((v) => v.id === variable)
    setSearchedLabel(varMeta?.label || variable)
    setLoading(true)
    setError(null)
    setResults(null)
    try {
      const data = await getBusqueda({ filters, variable, tipo })
      setResults(data.results || [])
    } catch (err) {
      setError(err?.message || 'Error al realizar la búsqueda')
    } finally {
      setLoading(false)
    }
  }

  const selectedVar = variable ? VARIABLES[tipo].find((v) => v.id === variable) : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl2 border border-line dark:border-d-line bg-white dark:bg-d-card shadow-card p-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20">
            <Search className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-ink-800 dark:text-d-text" style={{ fontFamily: 'Libre Baskerville' }}>
              Búsqueda por indicador de riesgo
            </h2>
            <p className="text-xs text-ink-500 dark:text-d-muted mt-1 leading-relaxed max-w-2xl">
              Selecciona qué quieres analizar (proyectos, proveedores o alcaldes) y el indicador
              de riesgo de interés. El sistema devolverá los 20 casos más relevantes con la
              razón por la que fueron identificados.
            </p>
          </div>
        </div>
      </div>

      {/* Step 1 – Tipo selector */}
      <SectionCard
        title="1. ¿Qué quieres analizar?"
        subtitle="Elige si buscas proyectos específicos, proveedores con patrones de riesgo, o alcaldes con gestión irregular."
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {TIPOS.map((t) => {
            const Icon = t.icon
            const active = tipo === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => handleTipoChange(t.id)}
                className={`text-left p-4 rounded-xl border-2 transition-all ${
                  active
                    ? 'border-accent bg-accent/5 dark:bg-accent/10'
                    : 'border-line dark:border-d-line hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <div className={`p-2 rounded-lg w-fit mb-3 ${active ? 'bg-accent/10' : 'bg-slate-100 dark:bg-slate-800'}`}>
                  <Icon className={`w-5 h-5 ${active ? 'text-accent' : 'text-ink-400 dark:text-d-muted'}`} />
                </div>
                <div className={`text-sm font-semibold ${active ? 'text-accent' : 'text-ink-800 dark:text-d-text'}`}>
                  {t.label}
                </div>
                <div className="text-xs text-ink-400 dark:text-d-muted mt-1 leading-snug">
                  {t.descripcion}
                </div>
              </button>
            )
          })}
        </div>
      </SectionCard>

      {/* Step 2 – Variable selector */}
      <SectionCard
        title="2. Selecciona el indicador de riesgo"
        subtitle="Cada indicador refleja un patrón específico de irregularidad. El nivel de riesgo indica la severidad del patrón."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {VARIABLES[tipo].map((v) => {
            const nivel = NIVEL_STYLES[v.nivel]
            const active = variable === v.id
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => { setVariable(v.id); setResults(null); setError(null) }}
                className={`text-left p-4 rounded-xl border-2 transition-all ${
                  active
                    ? `${nivel.border} ${nivel.bg}`
                    : 'border-line dark:border-d-line hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className={`text-sm font-semibold ${active ? 'text-ink-800 dark:text-d-text' : 'text-ink-700 dark:text-d-text'}`}>
                    {v.label}
                  </span>
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${nivel.badge}`}>
                    {nivel.label}
                  </span>
                </div>
                <p className="text-xs text-ink-500 dark:text-d-muted leading-relaxed">
                  {v.descripcion}
                </p>
                <div className="mt-2 text-xs text-ink-400 dark:text-d-muted font-mono bg-slate-100 dark:bg-slate-800 rounded px-2 py-1 w-fit">
                  {v.umbral}
                </div>
              </button>
            )
          })}
        </div>

        {/* Search button */}
        <div className="mt-5 flex items-center gap-4">
          <button
            type="button"
            onClick={handleSearch}
            disabled={!variable || loading}
            className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              variable && !loading
                ? 'bg-accent text-white hover:bg-accent/90 shadow-sm'
                : 'bg-slate-200 dark:bg-slate-700 text-ink-400 dark:text-d-muted cursor-not-allowed'
            }`}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            {loading ? 'Buscando…' : 'Buscar top 20'}
          </button>
          {!variable && (
            <span className="text-xs text-ink-400 dark:text-d-muted">
              Selecciona un indicador para activar la búsqueda.
            </span>
          )}
        </div>
      </SectionCard>

      {/* Results */}
      {(results !== null || loading || error) && (
        <SectionCard
          title={`Resultados · ${searchedLabel}`}
          subtitle={
            results !== null
              ? `${results.length === 0 ? 'Sin coincidencias' : `Top ${results.length} caso${results.length !== 1 ? 's' : ''}`} · Los filtros activos del panel lateral aplican sobre esta búsqueda.`
              : ''
          }
        >
          {loading && (
            <div className="flex items-center justify-center gap-3 py-12 text-ink-400 dark:text-d-muted text-sm">
              <Loader2 className="w-5 h-5 animate-spin" />
              Analizando datos…
            </div>
          )}

          {error && (
            <EmptyState
              icon={AlertTriangle}
              title="Error en la búsqueda"
              message={error}
            />
          )}

          {!loading && !error && results !== null && results.length === 0 && (
            <EmptyState
              title="Sin resultados"
              message="No se encontraron registros que cumplan el criterio con los filtros aplicados. Prueba ampliando los filtros del panel lateral."
            />
          )}

          {!loading && !error && results !== null && results.length > 0 && (
            <div className="space-y-3">
              {tipo === 'proyectos' &&
                results.map((item, i) => <ProyectoCard key={item.snip ?? i} item={item} index={i} />)}
              {tipo === 'proveedores' &&
                results.map((item, i) => <ProveedorCard key={item.nombre + i} item={item} index={i} />)}
              {tipo === 'alcaldes' &&
                results.map((item, i) => <AlcaldeCard key={item.nombre + i} item={item} index={i} />)}
            </div>
          )}
        </SectionCard>
      )}
    </div>
  )
}

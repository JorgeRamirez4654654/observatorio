import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  Award,
  BarChart2,
  TrendingUp,
  Users,
} from 'lucide-react'
import { getCompetencia } from '../../api/client.js'
import { formatMoney, formatNumber, formatPercent } from '../../utils/format.js'
import { useTheme } from '../../contexts/ThemeContext.jsx'
import LoadingSpinner from '../common/LoadingSpinner.jsx'
import EmptyState from '../common/EmptyState.jsx'
import SectionCard from '../common/SectionCard.jsx'
import DataTable from '../common/DataTable.jsx'
import KpiCard from '../common/KpiCard.jsx'
import InsightCard from '../common/InsightCard.jsx'
import InsightDetailModal from '../common/InsightDetailModal.jsx'

// ─── chart colours ──────────────────────────────────────────────────────────

const DIST_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6']

function chartColors(isDark) {
  return {
    grid: isDark ? '#334155' : '#e2e8f0',
    text: isDark ? '#94a3b8' : '#64748b',
    bar: isDark ? '#3b82f6' : '#2563eb',
    barSecondary: isDark ? '#6366f1' : '#4f46e5',
    tooltip: isDark ? '#1e293b' : '#ffffff',
    tooltipBorder: isDark ? '#334155' : '#e2e8f0',
  }
}

// ─── shared tooltip style ───────────────────────────────────────────────────

function TooltipBox({ isDark, children }) {
  return (
    <div
      style={{
        background: isDark ? '#1e293b' : '#ffffff',
        border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 12,
      }}
    >
      {children}
    </div>
  )
}

// ─── Distribution histogram ──────────────────────────────────────────────────

function DistribucionChart({ data, isDark }) {
  const c = chartColors(isDark)
  if (!data?.length) return <EmptyState title="Sin datos" message="No hay distribución disponible." />

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <TooltipBox isDark={isDark}>
        <div className="font-semibold">{d.n_oferentes} oferente{d.n_oferentes !== '1' ? 's' : ''}</div>
        <div>{formatNumber(d.count)} proyectos · {formatPercent(d.pct)}</div>
      </TooltipBox>
    )
  }

  return (
    <div style={{ width: '100%', height: 260, minWidth: 0 }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
          <XAxis dataKey="n_oferentes" tick={{ fill: c.text, fontSize: 12 }} />
          <YAxis tick={{ fill: c.text, fontSize: 12 }} width={48} tickFormatter={(v) => formatNumber(v)} />
          <RTooltip content={<CustomTooltip />} cursor={{ fill: isDark ? '#1e293b' : '#f1f5f9' }} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {data.map((entry, i) => (
              <Cell key={entry.n_oferentes} fill={DIST_COLORS[i] || '#64748b'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Sector avg tenderers bar chart ─────────────────────────────────────────

function SectorChart({ data, isDark }) {
  const c = chartColors(isDark)
  if (!data?.length) return <EmptyState title="Sin datos" message="No hay datos por sector." />

  // Show top 15 sectors
  const rows = [...data].slice(0, 15)
  const height = Math.max(260, rows.length * 32)

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <TooltipBox isDark={isDark}>
        <div className="font-semibold text-xs">{d.sector}</div>
        <div>Promedio: <strong>{d.avg_oferentes?.toFixed(2)}</strong> oferentes</div>
        <div>{formatNumber(d.count)} proyectos</div>
      </TooltipBox>
    )
  }

  return (
    <div style={{ width: '100%', height, minWidth: 0 }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: c.text, fontSize: 11 }}
            domain={[0, 'dataMax + 0.5']}
            tickFormatter={(v) => v.toFixed(1)}
          />
          <YAxis
            type="category"
            dataKey="sector"
            tick={{ fill: c.text, fontSize: 10 }}
            width={140}
            tickFormatter={(v) => (v?.length > 22 ? v.slice(0, 22) + '…' : v)}
          />
          <RTooltip content={<CustomTooltip />} cursor={{ fill: isDark ? '#1e293b' : '#f1f5f9' }} />
          <Bar dataKey="avg_oferentes" fill={c.bar} radius={[0, 4, 4, 0]} label={{ position: 'right', fill: c.text, fontSize: 10, formatter: (v) => v?.toFixed(2) }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Award amount by tenderer bucket ────────────────────────────────────────

function MontoChart({ data, isDark }) {
  const c = chartColors(isDark)
  if (!data?.length) return <EmptyState title="Sin datos" message="No hay estadísticas de monto disponibles." />

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const d = payload[0]?.payload
    return (
      <TooltipBox isDark={isDark}>
        <div className="font-semibold">{d.bucket} oferente{d.bucket !== '1' ? 's' : ''}</div>
        <div>Promedio: <strong>{formatMoney(d.avg_monto)}</strong></div>
        <div>Mediana: {formatMoney(d.median_monto)}</div>
        <div>{formatNumber(d.count)} proyectos</div>
      </TooltipBox>
    )
  }

  return (
    <div style={{ width: '100%', height: 280, minWidth: 0 }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
          <XAxis dataKey="bucket" tick={{ fill: c.text, fontSize: 12 }} tickFormatter={(v) => `${v} of.`} />
          <YAxis
            tick={{ fill: c.text, fontSize: 11 }}
            width={64}
            tickFormatter={(v) => {
              if (v >= 1_000_000) return `Q${(v / 1_000_000).toFixed(1)}M`
              if (v >= 1_000) return `Q${(v / 1_000).toFixed(0)}K`
              return `Q${v}`
            }}
          />
          <RTooltip content={<CustomTooltip />} cursor={{ fill: isDark ? '#1e293b' : '#f1f5f9' }} />
          <Bar dataKey="avg_monto" name="Promedio" fill={c.bar} radius={[4, 4, 0, 0]} />
          <Bar dataKey="median_monto" name="Mediana" fill={c.barSecondary} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Shared project table ───────────────────────────────────────────────────

const METHOD_LABEL = {
  // Guatemala LCE short codes (from procurementMethodDetails)
  directa: 'Compra Directa',
  excepcion: 'Excepción (Art.44)',
  cotizacion: 'Cotización',
  licitacion: 'Licitación Pública',
  competitiva: 'Compra Competitiva',
  art54: 'Art. 54 LCE',
  convenio: 'Convenio/Tratado',
  arrendamiento: 'Arrendamiento',
  donacion: 'Donación',
  'entre-publicas': 'Entre Entidades',
  // OCDS fallbacks
  open: 'Abierta',
  selective: 'Selectiva',
  limited: 'Limitada',
  direct: 'Directa',
}

const PROJ_COLS = [
  { key: 'snip', header: 'SNIP' },
  { key: 'proyecto', header: 'Proyecto' },
  { key: 'municipio', header: 'Municipio' },
  { key: 'sector', header: 'Sector' },
  { key: 'proveedor', header: 'Proveedor' },
  {
    key: 'metodo_contratacion',
    header: 'Método',
    render: (r) => METHOD_LABEL[r.metodo_contratacion?.toLowerCase()] ?? r.metodo_contratacion ?? '—',
  },
  { key: 'n_oferentes', header: 'Oferentes', align: 'right', render: (r) => formatNumber(r.n_oferentes) },
  { key: 'monto_adjudicado', header: 'Adjudicado', align: 'right', render: (r) => formatMoney(r.monto_adjudicado) },
]

// ─── Main component ─────────────────────────────────────────────────────────

export default function TabCompetencia({ filters }) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeInsight, setActiveInsight] = useState(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getCompetencia(filters)
      .then((d) => active && setData(d))
      .catch((err) => active && setError(err?.message || 'Error al cargar datos'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [filters])

  if (loading && !data) return <LoadingSpinner label="Cargando análisis de competencia…" />
  if (error) return <EmptyState icon={AlertTriangle} title="No se pudo cargar la información" message={error} />
  if (!data) return null

  const ins = data.insights || {}

  const insightItems = [
    {
      label: 'Alta concentración de oferente único',
      value: (
        <>
          El <strong>{formatPercent(ins.pct_unico)}</strong> de los proyectos con datos OCDS tuvo un solo oferente, sobre un total de <strong>{formatNumber(ins.total_con_datos)}</strong> registros.
        </>
      ),
      explanation:
        'Cuando el 90 % o más de los proyectos tiene un único oferente, la licitación es nominalmente competitiva pero en la práctica no lo es. Puede indicar que los términos de referencia fueron elaborados para favorecer a un proveedor específico, o que el proceso no es público y accesible. Una tasa de oferente único superior al 50 % es señal de alerta sistémica.',
    },
    ins.sector_mas_competitivo && {
      label: 'Sector más competitivo',
      value: (
        <>
          <strong>{ins.sector_mas_competitivo.sector}</strong> — promedio de <strong>{ins.sector_mas_competitivo.avg?.toFixed(2)}</strong> oferentes por proyecto ({formatNumber(ins.sector_mas_competitivo.count)} proyectos).
        </>
      ),
      explanation:
        'Los sectores con mayor promedio de oferentes son los más competitivos: varios proveedores compiten activamente por los contratos. Esto generalmente se traduce en menores costos adjudicados y mayor calidad del servicio. Comparar el precio adjudicado en estos sectores con los de baja competencia es un ejercicio útil para detectar sobreprecios.',
    },
    ins.sector_menos_competitivo && {
      label: 'Sector menos competitivo',
      value: (
        <>
          <strong>{ins.sector_menos_competitivo.sector}</strong> — promedio de <strong>{ins.sector_menos_competitivo.avg?.toFixed(2)}</strong> oferentes por proyecto ({formatNumber(ins.sector_menos_competitivo.count)} proyectos).
        </>
      ),
      explanation:
        'Un sector con promedio cercano a 1 oferente por proyecto es estructuralmente poco competitivo. Puede estar condicionado por requisitos técnicos muy específicos, pero también puede ser resultado de restricciones artificiales de mercado. Merece una revisión de si los pliegos técnicos son razonablemente accesibles para múltiples proveedores.',
    },
    {
      label: 'Relación entre competencia y monto adjudicado',
      value: (
        <>
          El monto promedio adjudicado con 1 oferente es <strong>{formatMoney(data.stats_por_oferentes?.find((s) => s.bucket === '1')?.avg_monto)}</strong> vs <strong>{formatMoney(data.stats_por_oferentes?.find((s) => s.bucket === '2')?.avg_monto)}</strong> con 2 oferentes y <strong>{formatMoney(data.stats_por_oferentes?.find((s) => s.bucket === '3')?.avg_monto)}</strong> con 3 o más.
        </>
      ),
      explanation:
        'Es esperable que los proyectos más grandes atraigan más oferentes. Sin embargo, si al controlar por sector o tipo de obra los proyectos con un solo oferente presentan montos similares o superiores a los competitivos, puede ser señal de que el precio fue establecido sin presión de mercado. El análisis por sector y municipio puede revelar patrones de sobreprecio sistemático.',
    },
  ].filter(Boolean)

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Proyectos con datos"
          value={formatNumber(ins.total_con_datos)}
          icon={BarChart2}
          description="Proyectos con información OCDS de oferentes."
        />
        <KpiCard
          label="Oferente único"
          value={formatPercent(ins.pct_unico)}
          icon={AlertTriangle}
          accent="danger"
          description="Proyectos con un solo oferente."
        />
        <KpiCard
          label="Promedio de oferentes"
          value={ins.avg_global?.toFixed(2) ?? '—'}
          icon={Users}
          description="Promedio global de oferentes por proyecto."
        />
        <KpiCard
          label="Máximo de oferentes"
          value={formatNumber(ins.max_tenderers)}
          icon={TrendingUp}
          accent="success"
          description="Proyecto con más oferentes registrados."
        />
      </div>

      {/* Insights */}
      <InsightCard
        title="Hallazgos · Competencia en contrataciones"
        subtitle="Análisis de la distribución de oferentes y su relación con montos adjudicados. Haz clic para ver la explicación."
        items={insightItems}
        onItemClick={setActiveInsight}
      />

      {/* Distribution */}
      <SectionCard
        title="Distribución por número de oferentes"
        subtitle="Cantidad de proyectos según cuántos oferentes participaron. El rojo indica el mayor riesgo de falta de competencia."
        tooltip="Solo se incluyen proyectos con dato de número de oferentes en el sistema OCDS."
      >
        <DistribucionChart data={data.distribucion} isDark={isDark} />
        <div className="mt-3 flex flex-wrap gap-2">
          {(data.distribucion || []).map((d, i) => (
            <span
              key={d.n_oferentes}
              className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full"
              style={{ background: (DIST_COLORS[i] || '#64748b') + '22', color: DIST_COLORS[i] || '#64748b' }}
            >
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: DIST_COLORS[i] || '#64748b' }} />
              {d.n_oferentes} of. — {formatPercent(d.pct)}
            </span>
          ))}
        </div>
      </SectionCard>

      {/* Sector chart */}
      <SectionCard
        title="Promedio de oferentes por sector"
        subtitle="Sectores ordenados de mayor a menor competencia (top 15). Un promedio alto indica mejor apertura del mercado."
        tooltip="Se consideran únicamente sectores con al menos 5 proyectos."
      >
        <SectorChart data={data.por_sector} isDark={isDark} />
      </SectionCard>

      {/* Award amount vs tenderer count */}
      <SectionCard
        title="Monto adjudicado según número de oferentes"
        subtitle="Promedio y mediana del monto adjudicado agrupado por cantidad de oferentes. Permite detectar si los proyectos con menos competencia tienen precios más altos."
        tooltip="Azul = promedio · Índigo = mediana. Montos en quetzales."
      >
        <div className="flex gap-4 mb-3">
          <span className="flex items-center gap-1.5 text-xs text-ink-500 dark:text-d-muted">
            <span className="inline-block w-3 h-3 rounded-sm bg-blue-500" />
            Promedio
          </span>
          <span className="flex items-center gap-1.5 text-xs text-ink-500 dark:text-d-muted">
            <span className="inline-block w-3 h-3 rounded-sm bg-indigo-500" />
            Mediana
          </span>
        </div>
        <MontoChart data={data.stats_por_oferentes} isDark={isDark} />
      </SectionCard>

      {/* Min tenderers table */}
      <SectionCard
        title="Proyectos con un solo oferente (mayor monto)"
        subtitle="Los 100 proyectos con oferente único ordenados por monto adjudicado descendente."
        tooltip="Proyectos con n_oferentes = 1 según datos OCDS. Incluye adjudicaciones directas y licitaciones formales con un solo participante."
      >
        {data.proyectos_min?.length ? (
          <DataTable
            columns={PROJ_COLS}
            data={data.proyectos_min}
            defaultSort={{ key: 'monto_adjudicado', direction: 'desc' }}
            searchPlaceholder="Buscar proyecto, municipio, proveedor…"
          />
        ) : (
          <EmptyState title="Sin datos" message="No hay proyectos con oferente único en la selección actual." />
        )}
      </SectionCard>

      {/* Max tenderers table */}
      <SectionCard
        title="Proyectos con más oferentes"
        subtitle="Los 100 proyectos con mayor número de oferentes registrados."
        tooltip="Estos proyectos representan el extremo más competitivo del mercado de contratación pública."
      >
        {data.proyectos_max?.length ? (
          <DataTable
            columns={PROJ_COLS}
            data={data.proyectos_max}
            defaultSort={{ key: 'n_oferentes', direction: 'desc' }}
            searchPlaceholder="Buscar proyecto, municipio, proveedor…"
          />
        ) : (
          <EmptyState title="Sin datos" message="No hay proyectos con múltiples oferentes en la selección actual." />
        )}
      </SectionCard>

      {/* Sector table */}
      {data.por_sector?.length > 0 && (
        <SectionCard
          title="Tabla completa por sector"
          subtitle="Promedio de oferentes, número de proyectos y monto total adjudicado por sector."
        >
          <DataTable
            columns={[
              { key: 'sector', header: 'Sector' },
              { key: 'count', header: 'Proyectos', align: 'right', render: (r) => formatNumber(r.count) },
              { key: 'avg_oferentes', header: 'Prom. oferentes', align: 'right', render: (r) => r.avg_oferentes?.toFixed(2) ?? '—' },
              { key: 'monto_total', header: 'Monto total', align: 'right', render: (r) => formatMoney(r.monto_total) },
            ]}
            data={data.por_sector}
            defaultSort={{ key: 'avg_oferentes', direction: 'desc' }}
            searchPlaceholder="Buscar sector…"
          />
        </SectionCard>
      )}

      {activeInsight && (
        <InsightDetailModal item={activeInsight} onClose={() => setActiveInsight(null)} />
      )}
    </div>
  )
}

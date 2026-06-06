import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import {
  AlertTriangle,
  Building2,
  Flag,
  ListChecks,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import { getPartidoDetalle, getPartidos } from '../../api/client.js'
import { formatMoney, formatNumber, formatPercent } from '../../utils/format.js'
import { useTheme } from '../../contexts/ThemeContext.jsx'
import LoadingSpinner from '../common/LoadingSpinner.jsx'
import EmptyState from '../common/EmptyState.jsx'
import InsightCard from '../common/InsightCard.jsx'
import InsightDetailModal from '../common/InsightDetailModal.jsx'
import SectionCard from '../common/SectionCard.jsx'
import DataTable from '../common/DataTable.jsx'
import SearchableSelect from '../common/SearchableSelect.jsx'
import KpiCard from '../common/KpiCard.jsx'

export default function TabPartidos({ filters }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(null)
  const [activeInsight, setActiveInsight] = useState(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setSelected(null)
    setDetail(null)
    getPartidos(filters)
      .then((d) => active && setData(d))
      .catch((err) => active && setError(err?.message || 'Error al cargar datos'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [filters])

  const loadDetail = useCallback(
    async (partido) => {
      if (!partido) return
      setDetailLoading(true)
      setDetailError(null)
      try {
        const d = await getPartidoDetalle(partido, filters)
        setDetail(d)
      } catch (err) {
        setDetailError(err?.response?.data?.detail || err?.message || 'Error al cargar detalle')
        setDetail(null)
      } finally {
        setDetailLoading(false)
      }
    },
    [filters]
  )

  useEffect(() => {
    if (selected) loadDetail(selected)
    else setDetail(null)
  }, [selected, loadDetail])

  if (loading) return <LoadingSpinner label="Cargando análisis…" />
  if (error) return <EmptyState icon={AlertTriangle} title="No se pudo cargar la información" message={error} />
  if (!data) return null

  const insights = data.insights || {}
  const items = [
    insights.top_monto && {
      label: 'Partido con mayor monto ejecutado',
      value: (
        <>
          <strong>{insights.top_monto.partido}</strong> — {formatMoney(insights.top_monto.monto)} · ratio meta {formatPercent(insights.top_monto.ratio_meta)}.
        </>
      ),
      explanation:
        'El partido con mayor volumen ejecutado no es necesariamente problemático, pero su ratio de cumplimiento de metas debe ser proporcional. Un alto gasto con bajo cumplimiento sugiere que se priorizó desembolsar el presupuesto por encima de verificar los resultados físicos.',
    },
    insights.top_alcaldes_2023 && {
      label: 'Más alcaldías ganadas en 2023',
      value: (
        <>
          <strong>{insights.top_alcaldes_2023.partido}</strong> con {formatNumber(insights.top_alcaldes_2023.alcaldes)} alcaldías ({formatPercent(insights.top_alcaldes_2023.pct)} del total).
        </>
      ),
      explanation:
        'Un partido con mayor representación municipal controla más contratos y fondos públicos. Cruzar el número de alcaldías con los indicadores de riesgo permite detectar si el tamaño político se traduce también en mayor incidencia de irregularidades.',
    },
    insights.top_proyectos && {
      label: 'Más proyectos ejecutados',
      value: (
        <>
          <strong>{insights.top_proyectos.partido}</strong> — {formatNumber(insights.top_proyectos.proyectos)} proyectos.
        </>
      ),
      explanation:
        'Un alto volumen de proyectos amplía la exposición al riesgo. Si este partido también presenta altas tasas de alertas (sospechosos, sin meta, fraccionamiento), la escala del problema se multiplica proporcionalmente.',
    },
    insights.worst_ratio && {
      label: 'Peor cumplimiento de meta',
      value: (
        <>
          <strong>{insights.worst_ratio.partido}</strong> con {formatPercent(insights.worst_ratio.ratio_meta)} promedio.
        </>
      ),
      explanation:
        'Un partido con sistemático bajo cumplimiento de metas físicas puede indicar una cultura institucional donde los alcaldes priorizan el gasto presupuestario sobre los resultados concretos. Si múltiples alcaldes del mismo partido muestran el mismo patrón, difícilmente es coincidencia.',
    },
    insights.top_sos && {
      label: 'Mayor proporción de proyectos sospechosos',
      value: (
        <>
          <strong>{insights.top_sos.partido}</strong> — {formatPercent(insights.top_sos.ratio)} de su cartera.
        </>
      ),
      explanation:
        'Un partido con alta tasa de proyectos sospechosos puede indicar prácticas sistémicas: si múltiples alcaldes del mismo partido muestran el mismo patrón (gasto >95 % con meta <50 %), puede haber directrices compartidas, redes de proveedores comunes, o controles internos deficientes.',
    },
  ].filter(Boolean)

  return (
    <div className="space-y-6">
      <InsightCard
        title="Hallazgos · Partidos políticos"
        subtitle="Comportamiento agregado por partido en términos de monto, proyectos y banderas de riesgo. Haz clic para analizar."
        items={items}
        onItemClick={setActiveInsight}
      />

      <SectionCard
        title="Resumen por partido"
        subtitle="Métricas agregadas por sigla política."
      >
        <DataTable
          columns={[
            { key: 'siglas_ganadora', header: 'Partido' },
            { key: 'proyectos', header: 'Proyectos', align: 'right', render: (r) => formatNumber(r.proyectos) },
            { key: 'alcaldes', header: 'Alcaldes', align: 'right', render: (r) => formatNumber(r.alcaldes) },
            { key: 'proveedores', header: 'Proveedores', align: 'right', render: (r) => formatNumber(r.proveedores) },
            { key: 'monto_adjudicado', header: 'Adjudicado', align: 'right', render: (r) => formatMoney(r.monto_adjudicado, { compact: true }) },
            { key: 'monto_ejecutado', header: 'Ejecutado', align: 'right', render: (r) => formatMoney(r.monto_ejecutado, { compact: true }) },
            { key: 'ratio_promedio', header: 'Ratio meta', align: 'right', render: (r) => formatPercent(r.ratio_promedio) },
            { key: 'pct_sospechosos', header: '% Sospechosos', align: 'right', render: (r) => formatPercent(r.pct_sospechosos) },
            { key: 'pct_meta0_gasto', header: '% Sin meta', align: 'right', render: (r) => formatPercent(r.pct_meta0_gasto) },
            { key: 'pct_sobreejecucion', header: '% Sobreejec.', align: 'right', render: (r) => formatPercent(r.pct_sobreejecucion) },
          ]}
          data={data.table || []}
          defaultSort={{ key: 'monto_ejecutado', direction: 'desc' }}
          searchPlaceholder="Buscar partido…"
        />
      </SectionCard>

      <SectionCard
        title="Distribución de partidos"
        subtitle="Cada punto es un partido. X: proyectos · Y: monto ejecutado · Tamaño: monto adjudicado."
        tooltip="Identifica partidos con muchos proyectos y/o gran volumen económico."
      >
        <ScatterPartidos data={data.scatter_data || []} />
      </SectionCard>

      <SectionCard
        title="Buscar partido"
        subtitle="Detalle de proyectos, KPIs y evolución por año del partido seleccionado."
      >
        <div className="max-w-md mb-5">
          <SearchableSelect
            label="Partido"
            placeholder="Buscar y seleccionar partido…"
            options={data.partidos_list || []}
            value={selected}
            onChange={setSelected}
          />
        </div>

        {!selected ? (
          <EmptyState
            icon={Flag}
            title="Selecciona un partido"
            message="Elige un partido para ver su detalle."
          />
        ) : detailLoading ? (
          <LoadingSpinner label="Cargando detalle…" />
        ) : detailError ? (
          <EmptyState icon={AlertTriangle} title="No se encontraron datos" message={detailError} />
        ) : detail ? (
          <PartidoDetalle detail={detail} />
        ) : null}
      </SectionCard>

      {activeInsight && (
        <InsightDetailModal item={activeInsight} onClose={() => setActiveInsight(null)} />
      )}
    </div>
  )
}

function ScatterPartidos({ data }) {
  const { theme } = useTheme()
  const axisColor = theme === 'dark' ? '#94A3B8' : '#6B7280'
  const gridColor = theme === 'dark' ? '#243245' : '#E5E7EB'

  const rows = useMemo(
    () =>
      (data || [])
        .map((r) => ({
          name: r.siglas_ganadora,
          proyectos: r.proyectos,
          monto: r.monto_ejecutado,
          adjudicado: r.monto_adjudicado,
        }))
        .filter((r) => Number.isFinite(r.proyectos) && Number.isFinite(r.monto)),
    [data]
  )

  if (rows.length === 0) {
    return <EmptyState title="Sin datos suficientes" message="No hay partidos con datos para graficar." />
  }

  return (
    <div className="h-80" style={{ minWidth: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
          <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="proyectos"
            name="Proyectos"
            tick={{ fill: axisColor, fontSize: 11 }}
            stroke={axisColor}
            label={{ value: 'Proyectos', position: 'insideBottom', offset: -10, fill: axisColor, fontSize: 12 }}
          />
          <YAxis
            type="number"
            dataKey="monto"
            tick={{ fill: axisColor, fontSize: 11 }}
            stroke={axisColor}
            tickFormatter={(v) => formatMoney(v, { compact: true })}
            width={80}
          />
          <ZAxis type="number" dataKey="adjudicado" range={[60, 600]} name="Adjudicado" />
          <RTooltip
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null
              const p = payload[0].payload
              return (
                <div
                  style={{
                    backgroundColor: theme === 'dark' ? '#1A2535' : '#ffffff',
                    border: `1px solid ${gridColor}`,
                    borderRadius: 8,
                    color: theme === 'dark' ? '#F1F5F9' : '#1F2937',
                    fontSize: 12,
                    padding: '8px 10px',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.name}</div>
                  <div>Proyectos: <span className="num">{formatNumber(p.proyectos)}</span></div>
                  <div>Ejecutado: <span className="num">{formatMoney(p.monto)}</span></div>
                  <div>Adjudicado: <span className="num">{formatMoney(p.adjudicado)}</span></div>
                </div>
              )
            }}
          />
          <Scatter data={rows} fill="#2563EB" fillOpacity={0.7} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

function PartidoDetalle({ detail }) {
  const k = detail.kpis || {}
  const timeline = detail.timeline || []

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        <KpiCard label="Proyectos" value={formatNumber(k.total_proyectos)} icon={ListChecks} description="Total de proyectos." />
        <KpiCard label="Proveedores" value={formatNumber(k.total_proveedores)} icon={Building2} description="Proveedores únicos." />
        <KpiCard
          label="Monto ejecutado"
          value={formatMoney(k.monto_total_ejecutado, { compact: true })}
          icon={Wallet}
          accent="accent"
          description="Suma del gasto."
        />
        <KpiCard
          label="Ratio meta"
          value={formatPercent(k.ratio_promedio)}
          icon={Target}
          accent="success"
          description="Cumplimiento promedio."
        />
        <KpiCard
          label="Sospechosos"
          value={formatNumber(k.proyectos_sospechosos)}
          icon={AlertTriangle}
          accent="danger"
          description="Proyectos marcados."
        />
        <KpiCard
          label="Sin meta con gasto"
          value={formatNumber(k.proyectos_meta0_gasto)}
          icon={TrendingDown}
          accent="warn"
          description="Gasto sin meta."
        />
        <KpiCard
          label="Sobreejecución"
          value={formatNumber(k.proyectos_sobreejecucion)}
          icon={TrendingUp}
          accent="warn"
          description="Gasto > meta."
        />
        <KpiCard
          label="Cobertura partido"
          value={k.total_proveedores > 0 ? 'Activo' : '—'}
          icon={Users}
          description="Estado general."
        />
      </div>

      <SectionCard
        title="Evolución anual del partido"
        subtitle="Alcaldes en ejercicio por año y monto ejecutado correspondiente."
        tooltip="Eje izquierdo: número de alcaldes únicos por año. Eje derecho: monto ejecutado."
      >
        <TimelinePartido data={timeline} />
      </SectionCard>

      <DataTable
        columns={[
          { key: 'snip', header: 'SNIP' },
          { key: 'proyecto', header: 'Proyecto' },
          { key: 'municipio', header: 'Municipio' },
          { key: 'departamento', header: 'Departamento' },
          { key: 'alcalde_ganador', header: 'Alcalde' },
          { key: 'proveedor', header: 'Proveedor' },
          { key: 'monto_adjudicado', header: 'Adjudicado', align: 'right', render: (r) => formatMoney(r.monto_adjudicado) },
          { key: 'monto_ejecutado', header: 'Ejecutado', align: 'right', render: (r) => formatMoney(r.monto_ejecutado) },
          { key: 'ratio_meta_ejecucion', header: 'Ratio meta', align: 'right', render: (r) => formatPercent(r.ratio_meta_ejecucion) },
        ]}
        data={(detail.proyectos || []).map((r) => ({
          ...r,
          _risk:
            r.sin_meta_ejecutada_con_gasto === 1
              ? 'sin_meta'
              : r.sospechoso === 1
                ? 'sospechoso'
                : r.sobreejecucion_financiera === 1
                  ? 'sobreejecucion'
                  : undefined,
        }))}
        defaultSort={{ key: 'monto_ejecutado', direction: 'desc' }}
        searchPlaceholder="Buscar proyecto, municipio, alcalde, proveedor…"
      />
    </div>
  )
}

function TimelinePartido({ data }) {
  const { theme } = useTheme()
  const axisColor = theme === 'dark' ? '#94A3B8' : '#6B7280'
  const gridColor = theme === 'dark' ? '#243245' : '#E5E7EB'

  if (!data || data.length === 0) {
    return <EmptyState title="Sin línea temporal" message="No se construyó una línea de tiempo para este partido." />
  }

  return (
    <div className="h-72" style={{ minWidth: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
          <XAxis dataKey="ejercicio" tick={{ fill: axisColor, fontSize: 11 }} stroke={axisColor} />
          <YAxis
            yAxisId="left"
            tick={{ fill: axisColor, fontSize: 11 }}
            stroke={axisColor}
            allowDecimals={false}
            label={{ value: 'Alcaldes', angle: -90, position: 'insideLeft', fill: axisColor, fontSize: 11 }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fill: axisColor, fontSize: 11 }}
            stroke={axisColor}
            tickFormatter={(v) => formatMoney(v, { compact: true })}
            width={80}
          />
          <RTooltip
            contentStyle={{
              backgroundColor: theme === 'dark' ? '#1A2535' : '#ffffff',
              border: `1px solid ${gridColor}`,
              borderRadius: 8,
              color: theme === 'dark' ? '#F1F5F9' : '#1F2937',
              fontSize: 12,
            }}
            formatter={(v, name) => {
              if (name === 'Monto ejecutado') return formatMoney(v)
              return formatNumber(v)
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: axisColor }} />
          <Bar yAxisId="left" dataKey="alcaldes_unicos" name="Alcaldes" fill="#93C5FD" radius={[4, 4, 0, 0]} />
          <Line yAxisId="right" type="monotone" dataKey="monto_ejecutado" name="Monto ejecutado" stroke="#2563EB" strokeWidth={2.5} dot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

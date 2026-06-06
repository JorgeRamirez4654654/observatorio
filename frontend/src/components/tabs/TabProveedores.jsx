import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  Building2,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  ListChecks,
  Target,
  TrendingDown,
  TrendingUp,
  Truck,
  Wallet,
} from 'lucide-react'
import { getProveedorDetalle, getProveedores } from '../../api/client.js'
import { formatMoney, formatNumber, formatPercent, nameFromLink } from '../../utils/format.js'
import { useTheme } from '../../contexts/ThemeContext.jsx'
import LoadingSpinner from '../common/LoadingSpinner.jsx'
import EmptyState from '../common/EmptyState.jsx'
import InsightCard from '../common/InsightCard.jsx'
import InsightDetailModal from '../common/InsightDetailModal.jsx'
import SectionCard from '../common/SectionCard.jsx'
import DataTable from '../common/DataTable.jsx'
import SearchableSelect from '../common/SearchableSelect.jsx'
import KpiCard from '../common/KpiCard.jsx'
import ExternalLink from '../common/ExternalLink.jsx'

export default function TabProveedores({ filters }) {
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
    getProveedores(filters)
      .then((d) => active && setData(d))
      .catch((err) => active && setError(err?.message || 'Error al cargar datos'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [filters])

  const loadDetail = useCallback(
    async (prov) => {
      if (!prov) return
      setDetailLoading(true)
      setDetailError(null)
      try {
        const d = await getProveedorDetalle(prov, filters)
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

  if (loading) return <LoadingSpinner label="Cargando análisis de proveedores…" />
  if (error) return <EmptyState icon={AlertTriangle} title="No se pudo cargar la información" message={error} />
  if (!data) return null

  const insights = data.insights || {}
  const items = [
    insights.top_monto && {
      label: 'Proveedor con mayor monto ejecutado',
      value: (
        <>
          <strong>{insights.top_monto.proveedor}</strong> — {formatMoney(insights.top_monto.monto)}.
        </>
      ),
      explanation:
        'Un proveedor con presencia dominante en el sistema puede ejercer influencia indebida en los procesos de adjudicación. No es ilegal per se, pero requiere verificar que todos sus contratos pasaron por procesos competitivos y que los montos reflejan precios de mercado.',
    },
    insights.top_municipios && {
      label: 'Proveedor con presencia en más municipios',
      value: (
        <>
          <strong>{insights.top_municipios.proveedor}</strong> con {formatNumber(insights.top_municipios.municipios)} municipios.
        </>
      ),
      explanation:
        'Una empresa que opera simultáneamente en muchos municipios puede estar operando por encima de su capacidad real. Si la calidad o el cumplimiento de metas físicas es bajo en estos contratos, puede indicar que el proveedor absorbe más trabajo del que puede ejecutar correctamente.',
    },
    insights.worst_ratio && {
      label: 'Peor cumplimiento de meta',
      value: (
        <>
          <strong>{insights.worst_ratio.proveedor}</strong> con {formatPercent(insights.worst_ratio.ratio)} promedio.
        </>
      ),
      explanation:
        'Un proveedor con bajo cumplimiento de metas físicas cobra los contratos sin entregar la obra prometida. Este patrón sostenido en múltiples proyectos y municipios es una señal clara de negligencia grave o participación en esquemas donde el objetivo real no es ejecutar la obra.',
    },
    insights.top_sos && {
      label: 'Más proyectos sospechosos',
      value: (
        <>
          <strong>{insights.top_sos.proveedor}</strong> — {formatNumber(insights.top_sos.casos)} casos ({formatPercent(insights.top_sos.ratio)}).
        </>
      ),
      explanation:
        'Un proveedor que aparece repetidamente en proyectos con gasto >95 % pero meta <50 % sugiere que el patrón no es accidental. Puede ser un actor que opera de forma sistemática en esquemas donde el pago se realiza sin verificar la entrega real de la obra.',
    },
    insights.top_meta0 && {
      label: 'Más proyectos "gasto sin meta"',
      value: (
        <>
          <strong>{insights.top_meta0.proveedor}</strong> — {formatNumber(insights.top_meta0.casos)} ({formatPercent(insights.top_meta0.ratio)}).
        </>
      ),
      explanation:
        'Un proveedor con múltiples proyectos donde se reporta gasto pero la meta física permanece en cero está cobrando sin que haya avance físico registrado. Este es uno de los indicadores de fraude más directos: dinero desembolsado, obra inexistente.',
    },
    insights.top_sobre && {
      label: 'Más proyectos con sobreejecución',
      value: (
        <>
          <strong>{insights.top_sobre.proveedor}</strong> — {formatNumber(insights.top_sobre.casos)} ({formatPercent(insights.top_sobre.ratio)}).
        </>
      ),
      explanation:
        'Un proveedor que constantemente supera el presupuesto adjudicado puede estar negociando contratos con montos artificialmente bajos para ganar licitaciones, y luego recuperar el margen con adiciones no competitivas al contrato original.',
    },
  ].filter(Boolean)

  return (
    <div className="space-y-6">
      <InsightCard
        title="Hallazgos · Proveedores"
        subtitle="Visión consolidada del desempeño de los proveedores. Haz clic en cada hallazgo para ver el análisis."
        items={items}
        onItemClick={setActiveInsight}
      />

      <SectionCard
        title="Resumen por proveedor"
        subtitle="Cartera, cobertura y banderas de riesgo."
      >
        <DataTable
          columns={[
            {
              key: 'proveedor',
              header: 'Proveedor',
              render: (r) =>
                r.proveedor_link ? (
                  <ExternalLink href={r.proveedor_link}>{r.proveedor || nameFromLink(r.proveedor_link)}</ExternalLink>
                ) : (
                  r.proveedor
                ),
            },
            { key: 'proyectos', header: 'Proyectos', align: 'right', render: (r) => formatNumber(r.proyectos) },
            { key: 'municipios', header: 'Municipios', align: 'right', render: (r) => formatNumber(r.municipios) },
            { key: 'alcaldes', header: 'Alcaldes', align: 'right', render: (r) => formatNumber(r.alcaldes) },
            {
              key: 'monto_total_ejecutado',
              header: 'Ejecutado',
              align: 'right',
              render: (r) => formatMoney(r.monto_total_ejecutado, { compact: true }),
            },
            {
              key: 'promedio_ratio_meta_ejecutada',
              header: 'Ratio meta',
              align: 'right',
              render: (r) => formatPercent(r.promedio_ratio_meta_ejecutada),
            },
            {
              key: 'proyectos_sospechosos',
              header: 'Sospechosos',
              align: 'right',
              render: (r) => formatNumber(r.proyectos_sospechosos),
            },
            {
              key: 'casos_sin_meta_ejecutada_con_gasto',
              header: 'Sin meta',
              align: 'right',
              render: (r) => formatNumber(r.casos_sin_meta_ejecutada_con_gasto),
            },
            {
              key: 'casos_sobreejecucion',
              header: 'Sobreejec.',
              align: 'right',
              render: (r) => formatNumber(r.casos_sobreejecucion),
            },
          ]}
          data={data.table || []}
          defaultSort={{ key: 'monto_total_ejecutado', direction: 'desc' }}
          searchPlaceholder="Buscar proveedor…"
        />
      </SectionCard>

      <SectionCard
        title="Buscar proveedor"
        subtitle="Detalle del proveedor seleccionado: KPIs, evolución y desempeño por municipio."
      >
        <div className="max-w-md mb-5">
          <SearchableSelect
            label="Proveedor"
            placeholder="Buscar y seleccionar proveedor…"
            options={data.proveedores_list || []}
            value={selected}
            onChange={setSelected}
          />
        </div>

        {!selected ? (
          <EmptyState icon={Truck} title="Selecciona un proveedor" message="Elige un proveedor para ver su detalle." />
        ) : detailLoading ? (
          <LoadingSpinner label="Cargando detalle…" />
        ) : detailError ? (
          <EmptyState icon={AlertTriangle} title="No se encontraron datos" message={detailError} />
        ) : detail ? (
          <ProveedorDetalle detail={detail} />
        ) : null}
      </SectionCard>

      {activeInsight && (
        <InsightDetailModal item={activeInsight} onClose={() => setActiveInsight(null)} />
      )}
    </div>
  )
}

function ProveedorDetalle({ detail }) {
  const k = detail.kpis || {}
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        <KpiCard label="Proyectos" value={formatNumber(k.total_proyectos)} icon={ListChecks} description="Total de proyectos." />
        <KpiCard label="Municipios" value={formatNumber(k.total_municipios)} icon={Building2} description="Municipios atendidos." />
        <KpiCard label="Alcaldes" value={formatNumber(k.total_alcaldes)} icon={Building2} description="Alcaldes asociados." />
        <KpiCard label="Partidos" value={formatNumber(k.total_partidos)} icon={Building2} description="Diversidad política." />
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
          label="% Sospechosos"
          value={formatPercent(k.pct_sospechosos)}
          icon={AlertTriangle}
          accent="danger"
          description="Proporción de proyectos marcados."
        />
        <KpiCard
          label="Sin meta con gasto"
          value={formatNumber(k.proyectos_sin_meta_con_gasto)}
          icon={TrendingDown}
          accent="warn"
          description="Proyectos con gasto sin meta."
        />
        <KpiCard
          label="Sobreejecución"
          value={formatNumber(k.proyectos_sobreejecucion)}
          icon={TrendingUp}
          accent="warn"
          description="Gasto > meta."
        />
        <KpiCard
          label="Años operando"
          value={formatNumber(k.anios_operacion)}
          icon={CalendarRange}
          description="Cobertura temporal."
        />
      </div>

      <SectionCard
        title="Evolución del monto ejecutado"
        subtitle="Monto ejecutado consolidado por año."
        tooltip="Tendencia agregada del gasto."
      >
        <EvolucionLine data={detail.evolucion_general || []} />
      </SectionCard>

      <SectionCard
        title="Detalle por municipio"
        subtitle="Despliega cada municipio para ver el detalle por año."
        tooltip="Permite identificar concentración geográfica del proveedor."
      >
        <ListaPorMunicipio data={detail.evolucion_por_municipio || []} />
      </SectionCard>

      <DataTable
        columns={[
          { key: 'snip', header: 'SNIP' },
          { key: 'proyecto', header: 'Proyecto' },
          { key: 'municipio', header: 'Municipio' },
          { key: 'departamento', header: 'Departamento' },
          { key: 'alcalde_ganador', header: 'Alcalde' },
          { key: 'siglas_ganadora', header: 'Partido' },
          { key: 'ejercicio', header: 'Año', align: 'right' },
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
        searchPlaceholder="Buscar proyecto, municipio, alcalde…"
      />
    </div>
  )
}

function EvolucionLine({ data }) {
  const { theme } = useTheme()
  const axisColor = theme === 'dark' ? '#94A3B8' : '#6B7280'
  const gridColor = theme === 'dark' ? '#243245' : '#E5E7EB'

  const rows = (data || []).filter((r) => r.ejercicio != null && r.monto_ejecutado != null)

  if (rows.length === 0) {
    return <EmptyState title="Sin datos" message="No hay evolución temporal disponible." />
  }

  return (
    <div className="h-64" style={{ minWidth: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
          <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
          <XAxis dataKey="ejercicio" tick={{ fill: axisColor, fontSize: 11 }} stroke={axisColor} />
          <YAxis
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
            formatter={(v) => formatMoney(v)}
          />
          <Line type="monotone" dataKey="monto_ejecutado" stroke="#2563EB" strokeWidth={2.5} dot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function ListaPorMunicipio({ data }) {
  const grouped = useMemo(() => {
    const map = new Map()
    for (const r of data || []) {
      const key = r.municipio
      if (!map.has(key)) map.set(key, { municipio: key, total: 0, rows: [] })
      const g = map.get(key)
      g.total += Number(r.monto_ejecutado) || 0
      g.rows.push(r)
    }
    return [...map.values()].sort((a, b) => b.total - a.total)
  }, [data])

  const [open, setOpen] = useState({})

  if (grouped.length === 0) {
    return <EmptyState title="Sin detalle por municipio" message="No hay registros para mostrar." />
  }

  return (
    <ul className="divide-y divide-line dark:divide-d-line border border-line dark:border-d-line rounded-lg overflow-hidden">
      {grouped.map((g) => {
        const isOpen = open[g.municipio]
        return (
          <li key={g.municipio} className="bg-white dark:bg-d-card">
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [g.municipio]: !o[g.municipio] }))}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-canvas dark:hover:bg-d-canvas transition-colors text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                {isOpen ? <ChevronDown size={14} className="text-ink-500 dark:text-d-muted" /> : <ChevronRight size={14} className="text-ink-500 dark:text-d-muted" />}
                <span className="font-medium text-ink-800 dark:text-d-text truncate">{g.municipio}</span>
              </div>
              <span className="text-sm font-semibold text-accent num shrink-0">{formatMoney(g.total, { compact: true })}</span>
            </button>
            {isOpen ? (
              <div className="px-4 pb-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-ink-500 dark:text-d-muted">
                      <th className="text-left py-2">Año</th>
                      <th className="text-left py-2">Alcalde</th>
                      <th className="text-left py-2">Partido</th>
                      <th className="text-right py-2">Monto ejecutado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows
                      .slice()
                      .sort((a, b) => (a.ejercicio || 0) - (b.ejercicio || 0))
                      .map((r, i) => (
                        <tr key={i} className="border-t border-line/60 dark:border-d-line/60">
                          <td className="py-1.5 num text-ink-800 dark:text-d-text">{r.ejercicio}</td>
                          <td className="py-1.5 text-ink-800 dark:text-d-text">{r.alcalde || '—'}</td>
                          <td className="py-1.5 text-ink-500 dark:text-d-muted">{r.partido || '—'}</td>
                          <td className="py-1.5 num text-right text-ink-800 dark:text-d-text">{formatMoney(r.monto_ejecutado)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

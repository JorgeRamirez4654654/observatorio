import { useEffect, useState } from 'react'
import { AlertTriangle, Box, DollarSign, Ruler } from 'lucide-react'
import { getCostoUnidad } from '../../api/client.js'
import { formatMoney, formatNumber, nameFromLink } from '../../utils/format.js'
import { useTheme } from '../../contexts/ThemeContext.jsx'
import BoxPlot from '../Charts/BoxPlot.jsx'
import LoadingSpinner from '../common/LoadingSpinner.jsx'
import EmptyState from '../common/EmptyState.jsx'
import InsightCard from '../common/InsightCard.jsx'
import InsightDetailModal from '../common/InsightDetailModal.jsx'
import SectionCard from '../common/SectionCard.jsx'
import DataTable from '../common/DataTable.jsx'
import SearchableSelect from '../common/SearchableSelect.jsx'
import KpiCard from '../common/KpiCard.jsx'
import ExternalLink from '../common/ExternalLink.jsx'

export default function TabCostoUnidad({ filters }) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [unidad, setUnidad] = useState('')
  const [activeInsight, setActiveInsight] = useState(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getCostoUnidad(filters, unidad)
      .then((d) => {
        if (!active) return
        setData(d)
        // Sync selected unit if backend resolved one
        if (!unidad && d?.insights?.selected_unit) setUnidad(d.insights.selected_unit)
      })
      .catch((err) => active && setError(err?.message || 'Error al cargar datos'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [filters, unidad])

  if (loading && !data) return <LoadingSpinner label="Cargando costos por unidad…" />
  if (error) return <EmptyState icon={AlertTriangle} title="No se pudo cargar la información" message={error} />
  if (!data) return null

  const insights = data.insights || {}
  const items = [
    insights.top_proyecto && {
      label: 'Proyecto con mayor costo unitario',
      value: (
        <>
          <strong>{insights.top_proyecto.proyecto}</strong> — {formatMoney(insights.top_proyecto.costo)} por unidad · {insights.top_proyecto.municipio} · {insights.top_proyecto.proveedor}.
        </>
      ),
      explanation:
        'Un costo por unidad extremadamente alto puede indicar sobreprecio, especificaciones técnicas infladas, o condiciones geográficas excepcionales. Es fundamental compararlo con proyectos del mismo tipo en otras regiones: si no hay razón justificada para el diferencial, puede tratarse de un contrato sobrevaluado.',
    },
    insights.top_proveedor && {
      label: 'Proveedor con mayor costo promedio',
      value: (
        <>
          <strong>{insights.top_proveedor.proveedor}</strong> — {formatMoney(insights.top_proveedor.costo_promedio)} ({formatNumber(insights.top_proveedor.proyectos)} proyectos).
        </>
      ),
      explanation:
        'Un proveedor con costos unitarios consistentemente superiores a la mediana puede estar cobrando sobreprecios sistemáticos. Si este proveedor sigue siendo adjudicado a pesar de sus altos costos en comparación con competidores, puede indicar que los procesos de licitación no son verdaderamente competitivos.',
    },
    insights.top_alcalde && {
      label: 'Alcalde con mayor costo promedio',
      value: (
        <>
          <strong>{insights.top_alcalde.alcalde}</strong> {insights.top_alcalde.partido ? `(${insights.top_alcalde.partido})` : ''} · {insights.top_alcalde.municipio} — {formatMoney(insights.top_alcalde.costo_promedio)} ({formatNumber(insights.top_alcalde.proyectos)} proyectos).
        </>
      ),
      explanation:
        'Un alcalde cuyos proyectos presentan costos unitarios sistemáticamente más altos puede estar aprobando contratos con precios inflados. Compararlo con alcaldes vecinos que ejecutan el mismo tipo de obra revela si el diferencial de costo es justificable o si constituye un patrón de sobreprecio.',
    },
  ].filter(Boolean)

  return (
    <div className="space-y-6">
      <SectionCard
        title="Costo por unidad física"
        subtitle="Compara cuánto cuesta cada unidad ejecutada según la unidad de medida del proyecto."
        tooltip="Selecciona la unidad de medida (por ejemplo, metros o aulas) para analizar costos comparables."
      >
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="max-w-xs w-full">
            <SearchableSelect
              label="Unidad de medida"
              placeholder="Selecciona una unidad…"
              options={data.unidades || []}
              value={unidad || insights.selected_unit || ''}
              onChange={(v) => setUnidad(v || '')}
              clearable={false}
            />
          </div>
          <div className="text-xs text-ink-500 dark:text-d-muted flex items-center gap-2">
            <Ruler size={12} />
            Unidad activa: <strong className="text-ink-800 dark:text-d-text">{insights.selected_unit || '—'}</strong>
          </div>
        </div>
      </SectionCard>

      <InsightCard
        title="Hallazgos · Costos unitarios"
        subtitle="Proyectos, proveedores y alcaldes con costos por unidad sobresalientes. Haz clic para analizar."
        items={items}
        onItemClick={setActiveInsight}
      />

      <SectionCard
        title="Distribución por departamento"
        subtitle="Costo por unidad: whiskers = rango sin outliers · caja = Q1–Q3 · línea = mediana · puntos = outliers."
        tooltip="Escala logarítmica. Los departamentos están ordenados de mayor a menor costo promedio. Los puntos fuera de los whiskers son proyectos atípicos."
      >
        <BoxPlot
          data={data.boxplot_data || []}
          unit={insights.selected_unit || unidad || ''}
          isDark={isDark}
        />
      </SectionCard>

      <SectionCard
        title="Proveedores por costo unitario"
        subtitle="Promedio y mediana del costo por unidad."
      >
        {data.table_proveedores?.length ? (
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
              { key: 'costo_promedio', header: 'Costo promedio', align: 'right', render: (r) => formatMoney(r.costo_promedio) },
              { key: 'costo_mediano', header: 'Costo mediano', align: 'right', render: (r) => formatMoney(r.costo_mediano) },
            ]}
            data={data.table_proveedores}
            defaultSort={{ key: 'costo_promedio', direction: 'desc' }}
            searchPlaceholder="Buscar proveedor…"
          />
        ) : (
          <EmptyState title="Sin proveedores" message="No hay datos para esta unidad." />
        )}
      </SectionCard>

      <SectionCard
        title="Alcaldes por costo unitario"
        subtitle="Costos por unidad agregados por alcalde."
      >
        {data.table_alcaldes?.length ? (
          <DataTable
            columns={[
              {
                key: 'alcalde_ganador',
                header: 'Alcalde',
                render: (r) =>
                  r.alcalde_link ? (
                    <ExternalLink href={r.alcalde_link}>{r.alcalde_ganador || nameFromLink(r.alcalde_link)}</ExternalLink>
                  ) : (
                    r.alcalde_ganador
                  ),
              },
              { key: 'proyectos', header: 'Proyectos', align: 'right', render: (r) => formatNumber(r.proyectos) },
              { key: 'costo_promedio', header: 'Costo promedio', align: 'right', render: (r) => formatMoney(r.costo_promedio) },
              { key: 'costo_mediano', header: 'Costo mediano', align: 'right', render: (r) => formatMoney(r.costo_mediano) },
            ]}
            data={data.table_alcaldes}
            defaultSort={{ key: 'costo_promedio', direction: 'desc' }}
            searchPlaceholder="Buscar alcalde…"
          />
        ) : (
          <EmptyState title="Sin alcaldes" message="No hay datos para esta unidad." />
        )}
      </SectionCard>

      {activeInsight && (
        <InsightDetailModal item={activeInsight} onClose={() => setActiveInsight(null)} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard
          label="Registros con costo"
          value={formatNumber(data.boxplot_data?.length)}
          icon={Box}
          description="Proyectos válidos para el cálculo."
        />
        <KpiCard
          label="Unidades disponibles"
          value={formatNumber(data.unidades?.length)}
          icon={Ruler}
          description="Diferentes unidades de medida."
        />
        <KpiCard
          label="Costo máximo registrado"
          value={formatMoney(insights.top_proyecto?.costo, { compact: true })}
          icon={DollarSign}
          accent="warn"
          description="Mayor costo por unidad detectado."
        />
      </div>
    </div>
  )
}


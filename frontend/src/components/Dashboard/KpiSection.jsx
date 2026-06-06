import { useEffect, useState } from 'react'
import {
  Building2,
  Database,
  Landmark,
  Receipt,
  ShieldCheck,
  Target,
  Truck,
  Wallet,
} from 'lucide-react'
import KpiCard from '../common/KpiCard.jsx'
import LoadingSpinner from '../common/LoadingSpinner.jsx'
import { getKpis } from '../../api/client.js'
import { formatMoney, formatNumber, formatPercent } from '../../utils/format.js'

export default function KpiSection({ filters }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getKpis(filters)
      .then((d) => active && setData(d))
      .catch((err) => active && setError(err?.message || 'Error al cargar KPIs'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [filters])

  if (loading && !data) return <LoadingSpinner label="Cargando indicadores…" />
  if (error)
    return (
      <div className="text-sm text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40 rounded-lg px-4 py-3">
        {error}
      </div>
    )
  if (!data) return null

  return (
    <section>
      <div className="flex items-baseline justify-between mb-4">
        <h2
          className="text-lg md:text-xl font-bold text-ink-900 dark:text-d-text"
          style={{ fontFamily: 'Libre Baskerville' }}
        >
          Indicadores generales
        </h2>
        <p className="text-xs text-ink-500 dark:text-d-muted hidden sm:block">
          Refleja los filtros aplicados
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Registros"
          value={formatNumber(data.registros)}
          description="Cantidad de filas en la base filtrada."
          icon={Database}
          tooltip="Número total de registros disponibles tras aplicar los filtros."
        />
        <KpiCard
          label="Municipios"
          value={formatNumber(data.municipios)}
          description="Municipalidades únicas dentro de los datos filtrados."
          icon={Building2}
          tooltip="Municipalidades distintas en el conjunto de datos filtrado."
          accent="accent"
        />
        <KpiCard
          label="Alcaldes"
          value={formatNumber(data.alcaldes)}
          description="Alcaldes únicos asociados a los proyectos."
          icon={Landmark}
          tooltip="Personas que ejercieron la alcaldía en los proyectos visibles."
        />
        <KpiCard
          label="Proveedores"
          value={formatNumber(data.proveedores)}
          description="Empresas o personas que recibieron contratos."
          icon={Truck}
          tooltip="Proveedores únicos (empresas o personas naturales) en la selección."
        />
        <KpiCard
          label="% Meta ejecutada"
          value={formatPercent(data.pct_meta_ejecutada)}
          description="Promedio del avance físico declarado frente a la meta."
          icon={Target}
          tooltip="Promedio del ratio entre meta ejecutada y meta planificada."
          accent="success"
        />
        <KpiCard
          label="Monto ejecutado"
          value={formatMoney(data.monto_ejecutado_total, { compact: true })}
          description="Suma del gasto reportado para los proyectos filtrados."
          icon={Wallet}
          tooltip="Suma total del monto ejecutado (gasto efectivo)."
          accent="accent"
        />
        <KpiCard
          label="Monto adjudicado"
          value={formatMoney(data.monto_adjudicado_total, { compact: true })}
          description="Total de contratos asignados a proveedores."
          icon={Receipt}
          tooltip="Suma del monto adjudicado en los procesos de contratación."
        />
        <KpiCard
          label="Estado de los datos"
          value={data.registros > 0 ? 'Disponible' : 'Sin datos'}
          description={data.registros > 0 ? 'Análisis operativo con los filtros actuales.' : 'Ajusta los filtros para ver resultados.'}
          icon={ShieldCheck}
          accent={data.registros > 0 ? 'success' : 'warn'}
        />
      </div>
    </section>
  )
}

import { useEffect, useRef, useState } from 'react'

const MARGIN = { top: 24, right: 20, bottom: 90, left: 68 }
const CHART_H = 340

function logLabel(val) {
  if (val >= 1_000_000) return `${val / 1_000_000}M`
  if (val >= 1_000) return `${val / 1_000}K`
  return `${val}`
}

function logTicks(minLog, maxLog) {
  const ticks = []
  for (let exp = minLog; exp <= maxLog; exp++) {
    ticks.push({ val: 10 ** exp, major: true })
    if (exp < maxLog) {
      ticks.push({ val: 2 * 10 ** exp, major: false })
      ticks.push({ val: 5 * 10 ** exp, major: false })
    }
  }
  return ticks
}

export default function BoxPlot({ data, unit, isDark }) {
  const containerRef = useRef(null)
  const [containerWidth, setContainerWidth] = useState(800)

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width)
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  if (!data || data.length === 0) return null

  // --- colour tokens ---
  const boxFill = isDark ? 'rgba(96,165,250,0.28)' : 'rgba(37,99,235,0.22)'
  const boxStroke = isDark ? '#60A5FA' : '#2563EB'
  const medianColor = isDark ? '#93C5FD' : '#1D4ED8'
  const outlierFill = isDark ? 'rgba(96,165,250,0.5)' : 'rgba(37,99,235,0.45)'
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)'
  const gridMajor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.13)'
  const labelColor = isDark ? '#94A3B8' : '#6B7280'
  const axisColor = isDark ? '#334155' : '#D1D5DB'
  const bg = isDark ? '#1A2535' : '#FFFFFF'

  // --- layout ---
  const minBandW = 36
  const naturalW = data.length * minBandW + MARGIN.left + MARGIN.right
  const svgWidth = Math.max(containerWidth, naturalW)
  const chartW = svgWidth - MARGIN.left - MARGIN.right
  const svgHeight = CHART_H + MARGIN.top + MARGIN.bottom
  const bandW = chartW / data.length
  const boxW = Math.min(bandW * 0.55, 40)

  // --- y scale (log) ---
  const allVals = data.flatMap((d) => [
    d.lower_fence, d.q1, d.median, d.q3, d.upper_fence,
    ...(d.outliers || []),
  ]).filter((v) => v > 0)

  if (allVals.length === 0) return null

  const globalMin = Math.min(...allVals)
  const globalMax = Math.max(...allVals)
  const minLog = Math.max(0, Math.floor(Math.log10(globalMin)))
  const maxLog = Math.ceil(Math.log10(globalMax))

  const yScale = (val) => {
    if (!val || val <= 0) return CHART_H
    const logVal = Math.log10(Math.max(val, 10 ** minLog))
    return CHART_H - ((logVal - minLog) / (maxLog - minLog)) * CHART_H
  }

  const ticks = logTicks(minLog, maxLog)

  return (
    <div ref={containerRef} className="w-full overflow-x-auto rounded-xl" style={{ background: bg }}>
      <svg
        width={svgWidth}
        height={svgHeight}
        style={{ display: 'block', fontFamily: 'Inter, system-ui, sans-serif' }}
        aria-label={`Box plot de costo por unidad (${unit}) por departamento`}
      >
        {/* Chart area */}
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* Grid lines */}
          {ticks.map(({ val, major }) => {
            const y = yScale(val)
            if (y < 0 || y > CHART_H) return null
            return (
              <g key={val}>
                <line
                  x1={0} x2={chartW} y1={y} y2={y}
                  stroke={major ? gridMajor : gridColor}
                  strokeWidth={major ? 1 : 0.7}
                />
                {major && (
                  <text
                    x={-10} y={y} dy="0.35em"
                    textAnchor="end"
                    fontSize={11}
                    fill={labelColor}
                  >
                    {logLabel(val)}
                  </text>
                )}
              </g>
            )
          })}

          {/* Y axis line */}
          <line x1={0} x2={0} y1={0} y2={CHART_H} stroke={axisColor} strokeWidth={1} />
          {/* X axis line */}
          <line x1={0} x2={chartW} y1={CHART_H} y2={CHART_H} stroke={axisColor} strokeWidth={1} />

          {/* Y axis label */}
          <text
            x={-52} y={CHART_H / 2}
            transform={`rotate(-90, -52, ${CHART_H / 2})`}
            textAnchor="middle"
            fontSize={11}
            fill={labelColor}
          >
            Costo por unidad (escala log)
          </text>

          {/* Boxes */}
          {data.map((d, i) => {
            const cx = i * bandW + bandW / 2
            const halfBox = boxW / 2
            const capHalf = boxW * 0.25

            const q1y = yScale(d.q1)
            const q3y = yScale(d.q3)
            const medy = yScale(d.median)
            const lowy = yScale(d.lower_fence)
            const highy = yScale(d.upper_fence)
            const boxH = Math.max(q1y - q3y, 2)

            return (
              <g key={d.departamento}>
                {/* Upper whisker */}
                <line x1={cx} x2={cx} y1={q3y} y2={highy} stroke={boxStroke} strokeWidth={1.5} strokeDasharray="none" />
                <line x1={cx - capHalf} x2={cx + capHalf} y1={highy} y2={highy} stroke={boxStroke} strokeWidth={1.5} />

                {/* Box (Q1–Q3) */}
                <rect
                  x={cx - halfBox} y={q3y}
                  width={boxW} height={boxH}
                  fill={boxFill}
                  stroke={boxStroke}
                  strokeWidth={1.2}
                  rx={2}
                />

                {/* Median line */}
                <line
                  x1={cx - halfBox} x2={cx + halfBox}
                  y1={medy} y2={medy}
                  stroke={medianColor}
                  strokeWidth={2.5}
                />

                {/* Lower whisker */}
                <line x1={cx} x2={cx} y1={q1y} y2={lowy} stroke={boxStroke} strokeWidth={1.5} />
                <line x1={cx - capHalf} x2={cx + capHalf} y1={lowy} y2={lowy} stroke={boxStroke} strokeWidth={1.5} />

                {/* Outliers */}
                {(d.outliers || []).map((v, j) => {
                  const oy = yScale(v)
                  if (oy < 0 || oy > CHART_H) return null
                  return (
                    <circle
                      key={j}
                      cx={cx} cy={oy}
                      r={3}
                      fill={outlierFill}
                      stroke={boxStroke}
                      strokeWidth={0.8}
                    />
                  )
                })}

                {/* X label */}
                <text
                  x={cx}
                  y={CHART_H + 10}
                  transform={`rotate(-45,${cx},${CHART_H + 10})`}
                  textAnchor="end"
                  fontSize={11}
                  fill={labelColor}
                >
                  {d.departamento}
                </text>
              </g>
            )
          })}
        </g>

        {/* Chart title */}
        <text
          x={MARGIN.left}
          y={14}
          fontSize={12}
          fontWeight={600}
          fill={labelColor}
        >
          {`Costo por unidad (${unit}) por departamento`}
        </text>
      </svg>
    </div>
  )
}

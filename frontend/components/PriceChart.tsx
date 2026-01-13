'use client'

import { useMemo } from 'react'
import { PricePoint } from '@/lib/priceHistory'

interface PriceChartProps {
  data: PricePoint[]
  width?: number
  height?: number
  showAxes?: boolean
  color?: string
  fillColor?: string
  className?: string
}

export function PriceChart({
  data,
  width = 300,
  height = 100,
  showAxes = false,
  color = '#238636',
  fillColor = 'rgba(35, 134, 54, 0.1)',
  className = '',
}: PriceChartProps) {
  const chartData = useMemo(() => {
    if (data.length < 2) return null

    const prices = data.map(d => d.price)
    const minPrice = Math.min(...prices)
    const maxPrice = Math.max(...prices)
    const priceRange = maxPrice - minPrice || 1

    const minTime = data[0].timestamp
    const maxTime = data[data.length - 1].timestamp
    const timeRange = maxTime - minTime || 1

    const padding = { top: 10, right: 10, bottom: showAxes ? 25 : 10, left: showAxes ? 50 : 10 }
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom

    // Generate path points
    const points = data.map((d, i) => {
      const x = padding.left + ((d.timestamp - minTime) / timeRange) * chartWidth
      const y = padding.top + (1 - (d.price - minPrice) / priceRange) * chartHeight
      return { x, y, price: d.price, time: d.timestamp }
    })

    // Create line path
    const linePath = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(' ')

    // Create fill path (closed area under the line)
    const fillPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom} Z`

    // Determine if price went up or down
    const isUp = prices[prices.length - 1] >= prices[0]

    return {
      points,
      linePath,
      fillPath,
      minPrice,
      maxPrice,
      isUp,
      padding,
      chartWidth,
      chartHeight,
    }
  }, [data, width, height, showAxes])

  if (!chartData) {
    return (
      <div
        className={`flex items-center justify-center text-[#8b949e] text-sm ${className}`}
        style={{ width, height }}
      >
        Not enough data
      </div>
    )
  }

  const lineColor = chartData.isUp ? '#238636' : '#f85149'
  const areaColor = chartData.isUp ? 'rgba(35, 134, 54, 0.15)' : 'rgba(248, 81, 73, 0.15)'

  return (
    <svg
      width={width}
      height={height}
      className={className}
      style={{ overflow: 'visible' }}
    >
      {/* Gradient definition */}
      <defs>
        <linearGradient id={`gradient-${chartData.isUp ? 'up' : 'down'}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {showAxes && (
        <g className="grid" stroke="#30363d" strokeWidth="1">
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = chartData.padding.top + ratio * chartData.chartHeight
            return (
              <line
                key={ratio}
                x1={chartData.padding.left}
                y1={y}
                x2={width - chartData.padding.right}
                y2={y}
                strokeDasharray="2,2"
                opacity="0.5"
              />
            )
          })}
        </g>
      )}

      {/* Fill area */}
      <path
        d={chartData.fillPath}
        fill={`url(#gradient-${chartData.isUp ? 'up' : 'down'})`}
      />

      {/* Line */}
      <path
        d={chartData.linePath}
        fill="none"
        stroke={lineColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Current price dot */}
      <circle
        cx={chartData.points[chartData.points.length - 1].x}
        cy={chartData.points[chartData.points.length - 1].y}
        r="4"
        fill={lineColor}
      />

      {/* Y-axis labels */}
      {showAxes && (
        <g className="y-axis" fill="#8b949e" fontSize="10">
          <text x={chartData.padding.left - 5} y={chartData.padding.top + 4} textAnchor="end">
            {formatPrice(chartData.maxPrice)}
          </text>
          <text x={chartData.padding.left - 5} y={height - chartData.padding.bottom} textAnchor="end">
            {formatPrice(chartData.minPrice)}
          </text>
        </g>
      )}
    </svg>
  )
}

// Mini sparkline version for compact displays
export function Sparkline({
  data,
  width = 80,
  height = 24,
  className = '',
}: {
  data: PricePoint[]
  width?: number
  height?: number
  className?: string
}) {
  const chartData = useMemo(() => {
    if (data.length < 2) return null

    const prices = data.map(d => d.price)
    const minPrice = Math.min(...prices)
    const maxPrice = Math.max(...prices)
    const priceRange = maxPrice - minPrice || 1

    const points = data.map((d, i) => {
      const x = (i / (data.length - 1)) * width
      const y = (1 - (d.price - minPrice) / priceRange) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })

    const isUp = prices[prices.length - 1] >= prices[0]

    return { points: points.join(' '), isUp }
  }, [data, width, height])

  if (!chartData) {
    return <div className={`${className}`} style={{ width, height }} />
  }

  const color = chartData.isUp ? '#238636' : '#f85149'

  return (
    <svg width={width} height={height} className={className}>
      <polyline
        points={chartData.points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Price change indicator
export function PriceChange({
  changePercent,
  className = '',
}: {
  changePercent: number
  className?: string
}) {
  const isUp = changePercent >= 0
  const color = isUp ? 'text-[#238636]' : 'text-[#f85149]'
  const arrow = isUp ? '↑' : '↓'

  return (
    <span className={`${color} ${className} font-medium`}>
      {arrow} {Math.abs(changePercent).toFixed(2)}%
    </span>
  )
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(0)
  if (price >= 1) return price.toFixed(2)
  if (price >= 0.01) return price.toFixed(4)
  return price.toFixed(6)
}

'use client'

import { formatDenom } from '@/lib/gno'

interface TokenInputProps {
  label?: string
  token: string
  value: string
  onChange: (value: string) => void
  balance?: bigint
  onMax?: () => void
  disabled?: boolean
  readOnly?: boolean
  placeholder?: string
  showPercentages?: boolean
  onPercentage?: (percent: number) => void
  error?: string
}

// Format number with commas
export function formatNumber(value: string | number, decimals = 6): string {
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return '0'

  const parts = num.toFixed(decimals).split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  // Remove trailing zeros after decimal
  if (parts[1]) {
    parts[1] = parts[1].replace(/0+$/, '')
    if (parts[1] === '') return parts[0]
  }

  return parts.join('.')
}

// Format bigint amount (assumes 6 decimals)
export function formatAmount(amount: bigint): string {
  const num = Number(amount) / 1_000_000
  return formatNumber(num)
}

export function TokenInput({
  label,
  token,
  value,
  onChange,
  balance,
  onMax,
  disabled = false,
  readOnly = false,
  placeholder = '0.00',
  showPercentages = false,
  onPercentage,
  error,
}: TokenInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow only valid number input
    const val = e.target.value
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      onChange(val)
    }
  }

  return (
    <div className={`bg-[#0d1117] rounded-xl p-4 ${error ? 'border border-[#f85149]' : ''}`}>
      <div className="flex justify-between mb-2">
        <span className="text-[#8b949e] text-sm">{label || formatDenom(token)}</span>
        {balance !== undefined && (
          <span className="text-sm text-[#8b949e]">
            Balance: <span className="text-white">{formatAmount(balance)}</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          className={`w-full bg-transparent text-2xl font-medium outline-none ${
            readOnly ? 'text-[#8b949e]' : 'text-white'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        />

        {onMax && balance && balance > 0n && !readOnly && (
          <button
            onClick={onMax}
            className="px-2 py-1 text-xs font-medium bg-[#238636]/20 text-[#238636] rounded-md hover:bg-[#238636]/30 transition"
          >
            MAX
          </button>
        )}
      </div>

      {showPercentages && onPercentage && !readOnly && (
        <div className="flex gap-2 mt-3">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              onClick={() => onPercentage(pct)}
              className="flex-1 py-1.5 text-xs font-medium bg-[#21262d] hover:bg-[#30363d] rounded-lg transition text-[#8b949e] hover:text-white"
            >
              {pct === 100 ? 'MAX' : `${pct}%`}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="text-[#f85149] text-sm mt-2">{error}</p>
      )}
    </div>
  )
}

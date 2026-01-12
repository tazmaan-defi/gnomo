'use client'

import { useState, ReactNode } from 'react'

interface TooltipProps {
  content: string | ReactNode
  children: ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
}

export function Tooltip({ content, children, position = 'top' }: TooltipProps) {
  const [show, setShow] = useState(false)

  // Position classes - adjusted to prevent off-screen
  // For top/bottom: use left-0 instead of center to prevent right-edge overflow
  const positionClasses = {
    top: 'bottom-full left-0 mb-2',
    bottom: 'top-full left-0 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }

  const arrowClasses = {
    top: 'top-full left-4 border-t-[#30363d] border-l-transparent border-r-transparent border-b-transparent',
    bottom: 'bottom-full left-4 border-b-[#30363d] border-l-transparent border-r-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-[#30363d] border-t-transparent border-b-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-[#30363d] border-t-transparent border-b-transparent border-l-transparent',
  }

  return (
    <div className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div className={`absolute z-[100] ${positionClasses[position]}`} style={{ animation: 'fadeIn 0.15s ease' }}>
          <div className="bg-[#21262d] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#c9d1d9] shadow-lg w-max max-w-[250px] whitespace-normal">
            {content}
          </div>
          <div className={`absolute border-4 ${arrowClasses[position]}`} />
        </div>
      )}
    </div>
  )
}

// Help icon with tooltip
interface HelpTooltipProps {
  content: string | ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
}

export function HelpTooltip({ content, position = 'top' }: HelpTooltipProps) {
  return (
    <Tooltip content={content} position={position}>
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#21262d] text-[#8b949e] text-xs cursor-help hover:bg-[#30363d] hover:text-white transition">
        ?
      </span>
    </Tooltip>
  )
}

// Common CLMM concept tooltips
export const CLMM_TOOLTIPS = {
  tick: "Ticks represent discrete price points. Each tick equals a 1% price change. Lower tick = lower price.",
  tickSpacing: "The minimum interval between position boundaries. Larger spacing = lower gas costs but less precision.",
  liquidity: "The amount of capital available for trading in a price range. More liquidity = less price impact.",
  priceRange: "The price bounds where your liquidity is active. You earn fees only when the price is within your range.",
  inRange: "Your position is earning fees because the current price is within your selected range.",
  outOfRange: "Your position is not earning fees. Consider adjusting your range or waiting for the price to return.",
  feeTier: "The percentage of each swap that goes to liquidity providers. Higher fees = more earnings but potentially less volume.",
  priceImpact: "The difference between the market price and the execution price. Large swaps have higher impact.",
  slippage: "Maximum price change you'll accept. If the price moves more than this, the transaction will fail.",
  concentratedLiquidity: "Unlike traditional AMMs, CLMM lets you focus your capital in specific price ranges for higher capital efficiency.",
}

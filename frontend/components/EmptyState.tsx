'use client'

import { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="text-center py-12 px-4">
      {icon && (
        <div className="mb-4 flex justify-center">
          <div className="w-16 h-16 rounded-full bg-[#21262d] flex items-center justify-center text-3xl">
            {icon}
          </div>
        </div>
      )}
      <h3 className="text-lg font-medium text-white mb-1">{title}</h3>
      {description && (
        <p className="text-[#8b949e] text-sm max-w-sm mx-auto mb-4">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 bg-[#238636] hover:bg-[#2ea043] text-white rounded-lg font-medium transition text-sm"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

// Pre-built empty states
export function NoPoolsEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <EmptyState
      icon="🌊"
      title="No Pools Yet"
      description="Be the first to create a liquidity pool and start earning trading fees."
      action={{ label: 'Create Pool', onClick: onCreate }}
    />
  )
}

export function NoPositionsEmpty({ onAdd }: { onAdd: () => void }) {
  return (
    <EmptyState
      icon="📍"
      title="No Positions"
      description="Add liquidity to a pool to start earning fees on trades within your price range."
      action={{ label: 'New Position', onClick: onAdd }}
    />
  )
}

export function WalletNotConnectedEmpty({ onConnect }: { onConnect: () => void }) {
  return (
    <EmptyState
      icon="🔗"
      title="Wallet Not Connected"
      description="Connect your wallet to view your positions and manage liquidity."
      action={{ label: 'Connect Wallet', onClick: onConnect }}
    />
  )
}

export function NoResultsEmpty() {
  return (
    <EmptyState
      icon="🔍"
      title="No Results"
      description="Try adjusting your search or filters to find what you're looking for."
    />
  )
}

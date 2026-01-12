'use client'

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`skeleton rounded ${className}`} />
}

export function PoolCardSkeleton() {
  return (
    <div className="p-4 bg-[#0d1117] rounded-xl border border-[#30363d]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            <Skeleton className="w-6 h-6 rounded-full" />
            <Skeleton className="w-6 h-6 rounded-full" />
          </div>
          <Skeleton className="w-24 h-5" />
        </div>
        <Skeleton className="w-16 h-5 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Skeleton className="w-20 h-3 mb-1" />
          <Skeleton className="w-16 h-5" />
        </div>
        <div>
          <Skeleton className="w-20 h-3 mb-1" />
          <Skeleton className="w-16 h-5" />
        </div>
        <div>
          <Skeleton className="w-20 h-3 mb-1" />
          <Skeleton className="w-16 h-5" />
        </div>
        <div>
          <Skeleton className="w-20 h-3 mb-1" />
          <Skeleton className="w-16 h-5" />
        </div>
      </div>
    </div>
  )
}

export function PositionCardSkeleton() {
  return (
    <div className="p-4 bg-[#0d1117] rounded-xl border border-[#30363d]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            <Skeleton className="w-6 h-6 rounded-full" />
            <Skeleton className="w-6 h-6 rounded-full" />
          </div>
          <Skeleton className="w-24 h-5" />
          <Skeleton className="w-16 h-5 rounded-full" />
        </div>
        <Skeleton className="w-20 h-5 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <Skeleton className="w-16 h-3 mb-1" />
          <Skeleton className="w-20 h-5" />
        </div>
        <div>
          <Skeleton className="w-16 h-3 mb-1" />
          <Skeleton className="w-20 h-5" />
        </div>
      </div>
      <div className="p-3 bg-[#21262d] rounded-lg mb-3">
        <Skeleton className="w-full h-3 mb-2" />
        <Skeleton className="w-full h-3" />
      </div>
      <Skeleton className="w-full h-10 rounded-lg" />
    </div>
  )
}

export function SwapSkeleton() {
  return (
    <div className="space-y-2">
      <div className="bg-[#0d1117] rounded-xl p-4">
        <div className="flex justify-between mb-2">
          <Skeleton className="w-24 h-8 rounded-lg" />
          <Skeleton className="w-20 h-4" />
        </div>
        <Skeleton className="w-32 h-8" />
      </div>
      <div className="flex justify-center">
        <Skeleton className="w-10 h-10 rounded-xl" />
      </div>
      <div className="bg-[#0d1117] rounded-xl p-4">
        <div className="flex justify-between mb-2">
          <Skeleton className="w-24 h-8 rounded-lg" />
          <Skeleton className="w-20 h-4" />
        </div>
        <Skeleton className="w-32 h-8" />
      </div>
    </div>
  )
}

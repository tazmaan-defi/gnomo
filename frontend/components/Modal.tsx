'use client'

import { ReactNode, useEffect } from 'react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  showCloseButton?: boolean
}

export function Modal({ isOpen, onClose, title, children, showCloseButton = true }: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        style={{ animation: 'fadeIn 0.2s ease' }}
      />
      {/* Modal */}
      <div
        className="relative bg-[#161b22] border border-[#30363d] rounded-2xl shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto"
        style={{ animation: 'slideIn 0.3s ease' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#30363d]">
          <h3 className="text-lg font-semibold">{title}</h3>
          {showCloseButton && (
            <button onClick={onClose} className="text-[#8b949e] hover:text-white transition p-1">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="p-4">
          {children}
        </div>
      </div>
    </div>
  )
}

interface ConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: string
  details?: { label: string; value: string }[]
  confirmText?: string
  confirmVariant?: 'primary' | 'danger'
  loading?: boolean
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  details,
  confirmText = 'Confirm',
  confirmVariant = 'primary',
  loading = false,
}: ConfirmModalProps) {
  const buttonClass = confirmVariant === 'danger'
    ? 'bg-[#f85149] hover:bg-[#da3633]'
    : 'bg-[#238636] hover:bg-[#2ea043]'

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} showCloseButton={!loading}>
      {description && (
        <p className="text-[#8b949e] mb-4">{description}</p>
      )}

      {details && details.length > 0 && (
        <div className="bg-[#0d1117] rounded-xl p-3 mb-4 space-y-2">
          {details.map((detail, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span className="text-[#8b949e]">{detail.label}</span>
              <span className="font-medium">{detail.value}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onClose}
          disabled={loading}
          className="flex-1 py-3 rounded-xl font-medium bg-[#21262d] hover:bg-[#30363d] transition disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={`flex-1 py-3 rounded-xl font-medium text-white transition disabled:opacity-50 ${buttonClass}`}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              Processing...
            </span>
          ) : confirmText}
        </button>
      </div>
    </Modal>
  )
}

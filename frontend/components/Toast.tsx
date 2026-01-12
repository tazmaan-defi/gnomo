'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

type ToastType = 'success' | 'error' | 'info' | 'warning' | 'loading'

interface Toast {
  id: number
  type: ToastType
  title: string
  message?: string
  duration?: number
}

interface ToastContextType {
  showToast: (type: ToastType, title: string, message?: string, duration?: number) => number
  success: (title: string, message?: string) => number
  error: (title: string, message?: string) => number
  info: (title: string, message?: string) => number
  warning: (title: string, message?: string) => number
  loading: (title: string, message?: string) => number
  dismiss: (id: number) => void
  update: (id: number, type: ToastType, title: string, message?: string) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within ToastProvider')
  return context
}

let toastId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const showToast = useCallback((type: ToastType, title: string, message?: string, duration = 5000) => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, type, title, message, duration }])
    // Loading toasts don't auto-dismiss
    if (duration > 0 && type !== 'loading') {
      setTimeout(() => removeToast(id), duration)
    }
    return id
  }, [removeToast])

  const dismiss = useCallback((id: number) => {
    removeToast(id)
  }, [removeToast])

  const update = useCallback((id: number, type: ToastType, title: string, message?: string) => {
    setToasts(prev => prev.map(t =>
      t.id === id ? { ...t, type, title, message } : t
    ))
    // Auto-dismiss after update (unless it's a loading toast)
    if (type !== 'loading') {
      const duration = type === 'error' ? 8000 : type === 'warning' ? 6000 : 5000
      setTimeout(() => removeToast(id), duration)
    }
  }, [removeToast])

  const success = useCallback((title: string, message?: string) => showToast('success', title, message), [showToast])
  const error = useCallback((title: string, message?: string) => showToast('error', title, message, 8000), [showToast])
  const info = useCallback((title: string, message?: string) => showToast('info', title, message), [showToast])
  const warning = useCallback((title: string, message?: string) => showToast('warning', title, message, 6000), [showToast])
  const loading = useCallback((title: string, message?: string) => showToast('loading', title, message, 0), [showToast])

  return (
    <ToastContext.Provider value={{ showToast, success, error, info, warning, loading, dismiss, update }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const configs = {
    success: { bg: 'bg-[#238636]', icon: '✓', border: 'border-[#2ea043]' },
    error: { bg: 'bg-[#f85149]', icon: '✕', border: 'border-[#da3633]' },
    warning: { bg: 'bg-[#f0883e]', icon: '⚠', border: 'border-[#d97706]' },
    info: { bg: 'bg-[#58a6ff]', icon: 'ℹ', border: 'border-[#388bfd]' },
    loading: { bg: 'bg-[#8957e5]', icon: null, border: 'border-[#8957e5]' },
  }
  const config = configs[toast.type]

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-xl border ${config.border} bg-[#161b22] shadow-lg animate-slide-in`}
      style={{ animation: 'slideIn 0.3s ease-out' }}
    >
      <div className={`${config.bg} w-6 h-6 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0`}>
        {toast.type === 'loading' ? (
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : config.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-white">{toast.title}</p>
        {toast.message && <p className="text-sm text-[#8b949e] mt-0.5 break-words">{toast.message}</p>}
      </div>
      {toast.type !== 'loading' && (
        <button onClick={onClose} className="text-[#8b949e] hover:text-white transition flex-shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

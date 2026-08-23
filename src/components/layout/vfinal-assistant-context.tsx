'use client'

import { createContext, useCallback, useContext, useState } from 'react'

interface AssistantPanelContextValue {
  isOpen: boolean
  open: () => void
  close: () => void
}

const AssistantPanelContext = createContext<AssistantPanelContextValue | null>(null)

/**
 * AIscentra — real, minimal open/close state for the sliding Assistant
 * panel. A small dedicated Context (not a prop threaded through every
 * page) since the trigger (VfinalHeader's own "Assistant" button) and
 * the panel itself (rendered once in VfinalPublicShell) are separate
 * components on every real page -- this is the standard, minimal React
 * pattern for that shape, not a new architectural convention
 * introduced without reason.
 */
export function VfinalAssistantPanelProvider({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  return (
    <AssistantPanelContext.Provider value={{ isOpen, open, close }}>
      {children}
    </AssistantPanelContext.Provider>
  )
}

export function useAssistantPanel(): AssistantPanelContextValue {
  const ctx = useContext(AssistantPanelContext)
  if (!ctx) {
    throw new Error('useAssistantPanel must be used within VfinalAssistantPanelProvider')
  }
  return ctx
}

import type { Metadata } from 'next'
import { ObservatoryChat } from '@/components/assistant/chat'

export const metadata: Metadata = {
  title: 'Observatory Assistant',
  description:
    'Query Observatory intelligence using natural language. Grounded in verified signals and events.',
}

/**
 * AIscentra — vfinal /assistant page (Frontend Design Foundation,
 * layer 5C). The real ObservatoryChat component (src/components/
 * assistant/chat.tsx) is rendered unchanged, not rewritten -- only
 * wrapped in the shared VfinalPublicShell for the unified header/
 * footer. ObservatoryChat is a fully self-contained client component
 * (its own state, streaming, scroll, example queries) that does not
 * depend on its parent's layout structure.
 */
export default function AssistantPage(): React.JSX.Element {
  return (
    <>
      <ObservatoryChat />
    </>
  )
}

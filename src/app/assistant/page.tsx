import type { Metadata } from 'next'
import { ObservatoryChat } from '@/components/assistant/chat'

export const metadata: Metadata = {
  title: 'Observatory Assistant',
  description: 'Query Observatory intelligence using natural language. Grounded in verified signals and events.',
}

export default function AssistantPage(): React.JSX.Element {
  return <ObservatoryChat />
}

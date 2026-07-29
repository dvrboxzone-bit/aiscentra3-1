/**
 * AIscentra — Intelligence Agent Runtime: Task Router
 *
 * Determines TaskType from a natural-language query. Fully deterministic —
 * pattern-based, no LLM call. Each TaskType has its own downstream pipeline
 * shape, defined in planner.ts.
 */
import type { TaskType } from './types'

interface TaskTypePattern {
  type:     TaskType
  patterns: RegExp[]
}

const TASK_TYPE_PATTERNS: TaskTypePattern[] = [
  {
    type: 'COMPARE',
    patterns: [
      /\bcompare\b/i, /\bversus\b/i, /\bvs\.?\b/i, /\bdifference between\b/i,
      /\bhow does .+ differ from\b/i,
    ],
  },
  {
    type: 'TIMELINE',
    patterns: [
      /\btimeline\b/i, /\bhistory of\b/i, /\bchronolog/i, /\bover time\b/i,
      /\bevolution of\b/i,
    ],
  },
  {
    type: 'TREND',
    patterns: [
      /\btrend/i, /\bemerging pattern/i, /\bwhat.?s (?:happening|changing) (?:in|with)\b/i,
      /\bdirection of\b/i,
    ],
  },
  {
    type: 'MONITORING',
    patterns: [
      /\bmonitor\b/i, /\bwatch\b/i, /\balert me\b/i, /\bkeep (?:an eye|track) on\b/i,
      /\bnotify (?:me )?(?:when|if)\b/i,
    ],
  },
  {
    type: 'SUMMARY',
    patterns: [
      /\bsummar(?:y|ize)\b/i, /\bdigest\b/i, /\brecap\b/i, /\bwhat happened\b/i,
      /\bcatch me up\b/i,
    ],
  },
  {
    type: 'ENTITY',
    patterns: [
      /\bprofile\b/i, /\btell me about\b/i, /\bwho is\b/i, /\bwhat is\b/i,
      /\boverview of\b/i,
    ],
  },
  {
    type: 'INVESTIGATION',
    patterns: [
      /\binvestigate\b/i, /\bdeep.?dive\b/i, /\banaly(?:ze|sis)\b/i,
      /\bwhat.?s going on with\b/i, /\bexplain\b/i,
    ],
  },
]

/**
 * Classifies a natural-language query into a TaskType.
 * Falls back to INVESTIGATION if no pattern matches — the broadest,
 * most general-purpose pipeline.
 */
export function routeTask(query: string): TaskType {
  for (const { type, patterns } of TASK_TYPE_PATTERNS) {
    if (patterns.some(p => p.test(query))) {
      return type
    }
  }
  return 'INVESTIGATION'
}

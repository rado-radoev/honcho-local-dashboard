import type { Conclusion, ConclusionLevel, Message, Session } from '../types'

// Deterministic demo fixture generator (Round 3 deliverable).
// Everything here is derived from a seeded PRNG and fixed base dates —
// no Date.now(), no Math.random() — so demo renders, and therefore the
// screenshot baselines, are byte-stable across runs.
//
// hermes workspace shape: 3 peers (radoslav / hermes / claude, peers live
// in demoClient), 6 sessions, ~120 conclusions across all four levels
// with source chains, messages spread unevenly over 26 weeks.
// test-1 stays small: 6 hand-written + 4 generated conclusions = 10.

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
// 26 weeks before the newest demo data (2026-10-28).
export const HERMES_START_MS = Date.UTC(2026, 3, 29, 15, 0, 0)

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function makeSession(workspaceId: string, id: string, createdAt: string, isActive: boolean): Session {
  return {
    id,
    uid: `session_demo_${workspaceId}_${id}`,
    is_active: isActive,
    workspace_id: workspaceId,
    metadata: {},
    configuration: {},
    created_at: createdAt,
  }
}

export const HERMES_SESSIONS: Session[] = [
  makeSession('hermes', 'hermes-desktop', '2026-10-20T16:02:11Z', true),
  makeSession('hermes', 'evening-planning', '2026-10-26T02:41:37Z', false),
  makeSession('hermes', 'infra-setup', '2026-05-06T17:20:00Z', false),
  makeSession('hermes', 'learning-plan', '2026-06-17T15:44:00Z', false),
  makeSession('hermes', 'printer-research', '2026-09-09T18:31:00Z', false),
  makeSession('hermes', 'family-logistics', '2026-10-05T16:12:00Z', false),
]

export const HERMES_SESSION_PEERS: Record<string, string[]> = {
  'hermes-desktop': ['radoslav', 'hermes'],
  'evening-planning': ['radoslav', 'hermes'],
  'infra-setup': ['radoslav', 'hermes', 'claude'],
  'learning-plan': ['radoslav', 'claude'],
  'printer-research': ['radoslav', 'hermes'],
  'family-logistics': ['radoslav', 'hermes', 'claude'],
}

const MESSAGE_TEMPLATES: Array<[string, string]> = [
  ['radoslav', 'Let us pick up the infrastructure thread where we left off.'],
  ['hermes', 'Continuing from the saved context — here is the current state.'],
  ['radoslav', 'Please keep the answer short and show what you checked.'],
  ['hermes', 'Checked the config and the logs; summarizing the findings now.'],
  ['radoslav', 'That approach works. Note it down so we do not redo it.'],
  ['claude', 'Adding a second opinion: the simpler option looks safer here.'],
  ['radoslav', 'What are the trade-offs if we defer this by a week?'],
  ['hermes', 'Main cost of deferring is re-testing; the design itself is stable.'],
  ['radoslav', 'I prefer the option with fewer moving parts.'],
  ['hermes', 'Noted — fewest moving parts wins unless evidence says otherwise.'],
  ['claude', 'I can draft the checklist while you review the summary.'],
  ['radoslav', 'Good. Written checklist, no phone calls needed.'],
]

// Messages per hermes session, spread unevenly across the 26 weeks:
// each session lives in its own week window, counts vary 7–14.
const MESSAGE_PLAN: Array<{ sessionId: string; startWeek: number; count: number }> = [
  { sessionId: 'infra-setup', startWeek: 1, count: 14 },
  { sessionId: 'learning-plan', startWeek: 7, count: 10 },
  { sessionId: 'printer-research', startWeek: 19, count: 9 },
  { sessionId: 'family-logistics', startWeek: 22, count: 8 },
  { sessionId: 'hermes-desktop', startWeek: 24, count: 12 },
  { sessionId: 'evening-planning', startWeek: 25, count: 7 },
]

export function buildHermesMessages(): Record<string, Message[]> {
  const rng = mulberry32(20261029)
  const bySession: Record<string, Message[]> = {}
  for (const plan of MESSAGE_PLAN) {
    const peers = HERMES_SESSION_PEERS[plan.sessionId] ?? ['radoslav', 'hermes']
    const messages: Message[] = []
    for (let index = 0; index < plan.count; index += 1) {
      const template = MESSAGE_TEMPLATES[(index * 5 + plan.startWeek) % MESSAGE_TEMPLATES.length]
      const peerId = peers.includes(template[0]) ? template[0] : peers[index % peers.length]
      const at =
        HERMES_START_MS +
        plan.startWeek * 7 * DAY_MS +
        Math.floor(rng() * 6) * DAY_MS +
        Math.floor(rng() * 3600) * 1000
      messages.push({
        id: `msg_demo_hermes_${plan.sessionId}_${index + 1}`,
        content: template[1],
        peer_id: peerId,
        session_id: plan.sessionId,
        workspace_id: 'hermes',
        metadata: {},
        created_at: iso(at),
        token_count: 9 + Math.floor(rng() * 57),
      })
    }
    messages.sort((a, b) => a.created_at.localeCompare(b.created_at))
    bySession[plan.sessionId] = messages
  }
  return bySession
}

const EXPLICIT_FACTS: Record<string, string[]> = {
  radoslav: [
    'Radoslav prefers short, direct, evidence-backed answers',
    'Radoslav self-hosts services on Proxmox LXCs',
    'Radoslav prefers written communication over phone calls',
    'Radoslav runs Hermes Agent as a desktop app on Linux',
    'Radoslav keeps Honcho on an existing Postgres LXC',
    'Radoslav is learning the Vercel AI SDK with a Snake game project',
    'Radoslav wants a minimal filament stock for a first 3D printer',
    'Radoslav steers projects in terse, directive messages',
    'Radoslav has a Bulgarian accounting background',
    'Radoslav sold jewelry online for about ten years',
    'Radoslav works from home in San Diego',
    'Radoslav prefers the simplest workable stack',
  ],
  hermes: [
    'Hermes answers with GPT-class models via Azure Foundry',
    'Hermes uses Honcho as its long-term memory layer',
    'Hermes records durable user preferences as conclusions',
    'Hermes can switch providers per session',
  ],
  claude: [
    'Claude joins sessions as a second-opinion reviewer peer',
    'Claude prefers deterministic tests over snapshots of random data',
    'Claude writes short, broken-down components',
  ],
}

const DEDUCTIVE_TAILS = [
  'so summaries should lead with the checked evidence',
  'so new tooling should be verified against its own docs first',
  'so written, asynchronous hand-offs fit better than meetings',
  'so designs should surface cost before anything is built',
  'so a reversible trial beats a permanent commitment',
]
const INDUCTIVE_TAILS = [
  'based on the pattern across several sessions',
  'after the same preference appeared in three separate weeks',
  'generalizing from repeated corrections in chat',
  'inferred from a steady pattern of short approvals',
]
const CONTEXTS = [
  'in the infra-setup session',
  'during learning-plan work',
  'while planning the printer purchase',
  'in family logistics discussions',
  'during the evening planning session',
  'on the hermes-desktop session',
]

const LEVEL_PATTERN: ConclusionLevel[] = [
  'explicit', 'explicit', 'deductive', 'explicit', 'inductive',
  'explicit', 'deductive', 'explicit', 'inductive', 'explicit',
  'explicit', 'deductive', 'inductive', 'explicit', 'explicit',
  'deductive', 'explicit', 'inductive', 'explicit', 'contradiction',
]
const OBSERVED_PATTERN = ['radoslav', 'radoslav', 'radoslav', 'hermes', 'claude']

// 117 generated hermes conclusions (demoClient adds 3 hand-written ones
// for a total of 120). IDs are sequential: concl_hermes_g001…g117.
export function buildHermesConclusions(): Conclusion[] {
  const rng = mulberry32(424242)
  const sessionIds = HERMES_SESSIONS.map((session) => session.id)
  const messages = buildHermesMessages()
  const conclusions: Conclusion[] = []
  const lastIdByObserved = new Map<string, string>()
  for (let index = 0; index < 117; index += 1) {
    const id = `concl_hermes_g${String(index + 1).padStart(3, '0')}`
    const observed = OBSERVED_PATTERN[index % OBSERVED_PATTERN.length]
    let level = LEVEL_PATTERN[index % LEVEL_PATTERN.length]
    const facts = EXPLICIT_FACTS[observed]
    let content = `${facts[Math.floor(index / 3) % facts.length]} ${CONTEXTS[index % CONTEXTS.length]}.`
    if (level === 'deductive') {
      content = `${facts[index % facts.length]}, ${DEDUCTIVE_TAILS[index % DEDUCTIVE_TAILS.length]}.`
    }
    if (level === 'inductive') {
      content = `${facts[(index * 2) % facts.length]} — ${INDUCTIVE_TAILS[index % INDUCTIVE_TAILS.length]}.`
    }
    if (level === 'contradiction') {
      content = `${facts[index % facts.length]} — but a later message suggests the opposite, flagging a contradiction.`
    }
    // The one contradiction pair: adjacent, cross-referencing.
    if (index === 115) {
      level = 'contradiction'
      content = 'Radoslav prefers deep-work tasks in the morning.'
    }
    if (index === 116) {
      level = 'contradiction'
      content =
        'Radoslav prefers deep-work tasks late at night — contradicting the earlier morning preference.'
    }
    const observer = observed === 'hermes' ? (index % 2 === 0 ? 'claude' : 'radoslav') : 'hermes'
    const sessionId = sessionIds[(index * 5 + 2) % sessionIds.length]
    const at = HERMES_START_MS + Math.floor((index / 117) * 178 * DAY_MS) + Math.floor(rng() * 12 * 3600) * 1000
    const sessionMessages = messages[sessionId] ?? []
    const sourceMessageIds = sessionMessages
      .slice(index % Math.max(1, sessionMessages.length), (index % Math.max(1, sessionMessages.length)) + 2)
      .map((message) => message.id)
    // Derivation chain: each conclusion derives from the previous one
    // about the same observed peer, so per-peer chains run dozens deep
    // (well past the required depth 3).
    const sourceIds: string[] = []
    const previousSamePeer = lastIdByObserved.get(observed)
    if (previousSamePeer) sourceIds.push(previousSamePeer)
    if (index === 116) sourceIds.push('concl_hermes_g116')
    conclusions.push({
      id,
      content,
      observer_id: observer,
      observed_id: observed,
      session_id: sessionId,
      level,
      source_ids: sourceIds,
      source_message_ids: sourceMessageIds,
      times_derived: 1 + Math.floor(rng() * 6),
      created_at: iso(at),
    })
    lastIdByObserved.set(observed, id)
  }
  return conclusions
}

// Four extra test-1 conclusions (10 total with the 6 hand-written ones),
// chained onto the hand-written explicit conclusions by id.
export function buildTest1ExtraConclusions(): Conclusion[] {
  return [
    {
      id: 'concl_demo_test1_07',
      content: 'Bob tends to mediate when Alice and Charlie disagree about books.',
      observer_id: 'hermes',
      observed_id: 'bob',
      session_id: 'groupchat_1',
      level: 'inductive',
      source_ids: ['concl_demo_test1_04'],
      source_message_ids: ['msg_demo_10'],
      times_derived: 3,
      created_at: '2025-08-25T15:10:00Z',
    },
    {
      id: 'concl_demo_test1_08',
      content: 'Charlie will join the book club if he can pick the second book.',
      observer_id: 'hermes',
      observed_id: 'charlie',
      session_id: 'groupchat_1',
      level: 'deductive',
      source_ids: ['concl_demo_test1_06'],
      source_message_ids: ['msg_demo_9'],
      times_derived: 2,
      created_at: '2025-08-25T15:12:00Z',
    },
    {
      id: 'concl_demo_test1_09',
      content: 'Bob defers to Alice on first picks, which keeps the group in balance.',
      observer_id: 'hermes',
      observed_id: 'bob',
      session_id: 'groupchat_1',
      level: 'deductive',
      source_ids: ['concl_demo_test1_07'],
      source_message_ids: ['msg_demo_10'],
      times_derived: 4,
      created_at: '2025-08-25T15:20:00Z',
    },
    {
      id: 'concl_demo_test1_10',
      content: 'Charlie claims to dislike sci-fi yet agreed to read Dune — a contradiction.',
      observer_id: 'hermes',
      observed_id: 'charlie',
      session_id: 'groupchat_1',
      level: 'contradiction',
      source_ids: ['concl_demo_test1_05'],
      source_message_ids: ['msg_demo_4', 'msg_demo_11'],
      times_derived: 1,
      created_at: '2025-08-25T15:25:00Z',
    },
  ]
}

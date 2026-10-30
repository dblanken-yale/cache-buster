import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const CELLS = 20
// Default for the contextWarnK option: past this many tokens of context, models tend to lose
// focus and every later turn re-reads it all, so the count turns red. Yellow starts at 2/3 of it.
const CONTEXT_WARN_K = 150
// Red at this fraction of the model's context window: close to auto-compact.
// ponytail: 80% of the window approximates the auto-compact point; the exact threshold is only
// in $.session.usage({ breakdown: 'summary' }) (rawMaxTokens), if precision ever matters.
const CONTEXT_ALARM = 0.8
// Monitor's own default time limit, for a call that sets none.
const MONITOR_DEFAULT_TIMEOUT = 300_000
const ENDED = /^(completed|failed|killed|stopped|done|error|cancelled|canceled|timed[ _-]?out|expired)$/i

const lastAt = atom({ plugin: 'cache-buster', key: 'lastAt' } as const, null)
const hitRate = atom({ plugin: 'cache-buster', key: 'hitRate' } as const, 0)
const context = atom({ plugin: 'cache-buster', key: 'context' } as const, 0)
const window = atom({ plugin: 'cache-buster', key: 'window' } as const, 0)
const now = atom({ plugin: 'cache-buster', key: 'now' } as const, 0)

let warned = false

// Set when Compact is pressed mid-turn; the compact runs at the next turn.complete.
let pending = false

// $.session.compact() rejects in a headless session (-p, the SDK, the desktop app), so the
// Compact button shows only under the terminal REPL; elsewhere the row hints at /compact.
let interactive = false

// Background work the main loop launched and no notification has ended yet; and the armed
// check-in timer. Tracked from tool.call and turn.start, never Stop: on Team and Enterprise
// accounts the built-in cc-plugin-sec-default plugin passes Stop past every plugin.
type Work = {
  id: string
  description: string
  type: string
  /** A shell's output file: once nothing holds it open, the shell has ended. */
  outputPath?: string
  /** Epoch ms a monitor's time limit runs out; absent for a persistent one. */
  endsAt?: number
}
let bg: Work[] = []
let checkInTimer: { cancel(): void } | null = null

type Loose = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')

// The background task a main-loop call launched, if it launched one. Subagents are left to
// $.agent.list(), which knows their owner and live status.
function launched(tool: string, input: Loose, result: Loose, text: string, at: number): Work | undefined {
  if (tool === 'Bash' && str(result.backgroundTaskId)) {
    const outputPath =
      str(result.backgroundOutputPath) ||
      (/(\/[^\s'"`]+\.output)\b/.exec(text) ?? /written to:?\s*(\/\S+)/i.exec(text))?.[1]
    return {
      id: str(result.backgroundTaskId),
      description: str(input.description) || str(input.command),
      type: 'shell',
      ...(outputPath ? { outputPath } : {}),
    }
  }
  if (tool === 'Monitor' && str(result.taskId)) {
    const limit = Number(result.timeoutMs) || Number(input.timeout_ms) || MONITOR_DEFAULT_TIMEOUT
    return {
      id: str(result.taskId),
      description: str(input.description) || str(input.command),
      type: 'monitor',
      ...(result.persistent === true ? {} : { endsAt: at + limit }),
    }
  }
  if (tool === 'Workflow' && str(result.taskId)) {
    return {
      id: str(result.taskId),
      description: str(result.workflowName) || str(input.name) || str(input.scriptPath) || 'workflow',
      type: 'workflow',
    }
  }
  return undefined
}

// Each task notification names its task and, once it ended, how it ended. One turn can
// carry several, so each block is read on its own.
function absorbNotification(text: string) {
  const ended = new Set<string>()
  for (const block of text.split('<task-notification>')) {
    const id = /<task-id>([^<]+)<\/task-id>/.exec(block)?.[1]?.trim()
    const status = /<status>([^<]+)<\/status>/.exec(block)?.[1]?.trim() ?? ''
    if (id && ENDED.test(status)) ended.add(id)
  }
  if (ended.size) bg = bg.filter((w) => !ended.has(w.id))
}

// Drop tasks that ended without a notification turn: a monitor past its limit, or a shell
// whose output file nothing holds open any more.
async function prune($: EngineInterface) {
  const t = await $.clock.now()
  const ended = new Set<string>()
  for (const w of bg) {
    if (w.endsAt !== undefined && t > w.endsAt) ended.add(w.id)
    if (w.type !== 'shell' || !w.outputPath) continue
    try {
      const held = await $.process.run(['lsof', '-t', '--', w.outputPath])
      // lsof exits 1 when nothing holds the file; any other failure proves nothing.
      if (held.exitCode <= 1 && held.stdout.trim() === '') ended.add(w.id)
    } catch {
      // No lsof: the notification still ends the task.
    }
  }
  if (ended.size) bg = bg.filter((w) => !ended.has(w.id))
}

function disarm() {
  checkInTimer?.cancel()
  checkInTimer = null
}

const clip = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}...` : s)

async function reset($: EngineInterface) {
  warned = false
  pending = false
  disarm()
  await update($, lastAt, () => null)
}

// The engine refuses to compact while a turn runs, so hold it for the end of the turn.
function queue($: EngineInterface) {
  if (!pending) $.ui.toast('Will compact when this reply finishes.')
  pending = true
}

async function compact($: EngineInterface) {
  try {
    const r = await $.session.compact()
    pending = false
    if (r.skip) $.ui.toast(`Compact skipped: ${r.skip}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('a turn is running')) return queue($)
    pending = false
    $.ui.toast(msg)
  }
}

// Ask the idle main session for a progress report; that turn refreshes the cache.
async function checkInNow($: EngineInterface, ping: number) {
  await prune($)
  const work = new Map<string, Work>(bg.map((w) => [w.id, w]))
  for (const a of await $.agent.list()) {
    // Only the main loop's own agents: not a subagent's child, a plugin's, or a teammate.
    if (a.parentId || a.spawnedBy || a.type === 'teammate') continue
    if (['pending', 'running', 'waiting'].includes(a.status) && !work.has(a.id)) work.set(a.id, a)
  }
  if (!work.size) return
  $.ui.toast('Cache expires soon; asking for a progress report on background work.')
  const lines = [...work.values()].map((w) => `- ${clip(w.description)} (${w.type})`).join('\n')
  void $.prompt.submit({
    text:
      `cache-buster check-in: the prompt cache expires in about ${ping}m and background work is still running:\n${lines}\n` +
      'Reply with a short progress report: what has finished, what is still running, and anything blocked or failing. ' +
      'Do not start new work, and do not stop or wait on the running tasks.',
  })
}

// Fire the check-in `ping` minutes before the cache expires, counted from the last request.
async function arm($: EngineInterface, ttl: number, ping: number) {
  disarm()
  const [at, t] = await Promise.all([read($, lastAt), $.clock.now()])
  if (at === null) return
  checkInTimer = $.clock.after(Math.max(0, at + (ttl - ping) * 60_000 - t), () => checkInNow($, ping))
}

export const register: Register = (on, options) => {
  const ttl = Number(options.cacheMinutes) || 60
  const warn = Math.max(1, Math.round(ttl / 12))
  const caution = Math.max(warn + 1, ttl / 4)
  // Minutes left on the cache when the check-in fires.
  const ping = Math.max(1, Math.round(ttl / 15))
  const checkIn = options.checkIn !== 'off'
  // Tokens of context at which the count turns red; 0 or junk falls back to the default.
  const ctxWarn = (Number(options.contextWarnK) || CONTEXT_WARN_K) * 1000

  on('session.start', async ($, e, next) => {
    interactive = e.isInteractive
    const started = await next(e)
    const t0 = await $.clock.now()
    await update($, now, () => t0)
    $.clock.every(60_000, async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
      const at = await read($, lastAt)
      if (at !== null && !warned && ttl - (t - at) / 60_000 <= warn) {
        warned = true
        $.ui.toast(`Cache expires in ~${warn}m. ${interactive ? 'Compact' : 'Type /compact'} or send something.`)
      }
    })
    return started
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      bg = []
      await reset($)
    }
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && e.trigger !== 'precompute' && !r.skip) await reset($)
    return r
  })

  // A background task's notification starts a main turn; an ended one leaves the list.
  on('turn.start', async ($, e, next) => {
    if (!e.agentId && e.text.includes('<task-id>')) absorbNotification(e.text)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId || !('result' in r) || r.isError) return r
    try {
      const input = e as unknown as Loose
      const tool = String(e.tool)
      if (tool === 'TaskStop') {
        const stopped = str(input.task_id) || str(input.shell_id)
        bg = bg.filter((w) => w.id !== stopped)
        return r
      }
      const at = tool === 'Monitor' ? await $.clock.now() : 0
      const work = launched(tool, input, (r.result ?? {}) as Loose, r.text ?? '', at)
      if (work) bg = [...bg.filter((w) => w.id !== work.id), work].slice(-30)
    } catch {
      // Bookkeeping failed: the call's own result still goes back untouched.
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (pending && !e.agentId) void compact($)
    if (checkIn && !e.agentId) await arm($, ttl, ping)
    return r
  })

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (e.agentId || !r.usage) return r

    const u = r.usage
    const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
    disarm()
    const t = await $.clock.now()
    warned = false
    await update($, lastAt, () => t)
    await update($, now, () => t)
    await update($, hitRate, () => (total ? u.cache_read_input_tokens / total : 0))
    await update($, context, () => total)
    const { context: c } = await $.session.usage()
    await update($, window, () => c.window)
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const at = await read($, lastAt)
    if (e.props.hasSurvey || at === null) return next(e)

    const [t, hit, ctx, win] = await Promise.all([
      read($, now),
      read($, hitRate),
      read($, context),
      read($, window),
    ])
    const ageMin = Math.max(0, Math.floor((t - at) / 60_000))
    const leftMin = Math.max(0, ttl - ageMin)
    const filled = Math.round((leftMin / ttl) * CELLS)
    const color = leftMin <= warn ? 'red' : leftMin <= caution ? 'yellow' : 'green'
    const ctxColor =
      (win && ctx >= win * CONTEXT_ALARM) || ctx > ctxWarn ? 'red' : ctx > (ctxWarn * 2) / 3 ? 'yellow' : undefined
    const rate = Math.round(hit * 100)
    const { Box, Button, Text } = $.ui.resolve(e)
    // Stack whatever the bands beneath draw (other mods), instead of hiding it.
    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Box>
          <Text color={color}>● </Text>
          <Text dimColor>cache </Text>
          <Text color={color}>{leftMin === 0 ? 'expired' : `${leftMin}m left`} </Text>
          <Box gap={1}>
            {Array.from({ length: CELLS }, (_, i) => (
              <Text key={`cell${i}`} backgroundColor={i < filled ? color : 'gray'}>
                {' '}
              </Text>
            ))}
          </Box>
          <Text dimColor> {rate}% hit </Text>
          <Text color={ctxColor} dimColor={!ctxColor}>
            {Math.round(ctx / 1000)}k ctx{' '}
          </Text>
          {interactive ? (
            <Button
              key="compact"
              label="Compact"
              onPress={() => (e.props.isWorking ? queue($) : compact($))}
            />
          ) : (
            color !== 'green' && <Text dimColor>type /compact</Text>
          )}
        </Box>
        {below}
      </Box>
    )
  })
}

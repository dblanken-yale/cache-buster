import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const CELLS = 20
// Past this many tokens of context, models tend to lose focus.
const CONTEXT_WARN = 200_000
// Red at this fraction of the model's context window: close to auto-compact.
// ponytail: 80% of the window approximates the auto-compact point; the exact threshold is only
// in $.session.usage({ breakdown: 'summary' }) (rawMaxTokens), if precision ever matters.
const CONTEXT_ALARM = 0.8

const lastAt = atom({ plugin: 'cache-buster', key: 'lastAt' } as const, null)
const hitRate = atom({ plugin: 'cache-buster', key: 'hitRate' } as const, 0)
const context = atom({ plugin: 'cache-buster', key: 'context' } as const, 0)
const window = atom({ plugin: 'cache-buster', key: 'window' } as const, 0)
const now = atom({ plugin: 'cache-buster', key: 'now' } as const, 0)

let warned = false

async function reset($: EngineInterface) {
  warned = false
  await update($, lastAt, () => null)
}

export const register: Register = (on, options) => {
  const ttl = Number(options.cacheMinutes) || 60
  const warn = Math.max(1, Math.round(ttl / 12))
  const caution = Math.max(warn + 1, ttl / 4)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const t0 = await $.clock.now()
    await update($, now, () => t0)
    $.clock.every(60_000, async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
      const at = await read($, lastAt)
      if (at !== null && !warned && ttl - (t - at) / 60_000 <= warn) {
        warned = true
        $.ui.toast(`Cache expires in ~${warn}m. Compact or send something.`)
      }
    })
    return started
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await reset($)
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && e.trigger !== 'precompute' && !r.skip) await reset($)
    return r
  })

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (e.agentId || !r.usage) return r

    const u = r.usage
    const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
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
    const ctxColor = win && ctx >= win * CONTEXT_ALARM ? 'red' : ctx > CONTEXT_WARN ? 'yellow' : undefined
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
          <Button
            key="compact"
            label="Compact"
            onPress={() =>
              $.session.compact().then(
                r => {
                  if (r.skip) $.ui.toast(`Compact skipped: ${r.skip}`)
                },
                (err: unknown) => $.ui.toast(err instanceof Error ? err.message : String(err)),
              )
            }
          />
        </Box>
        {below}
      </Box>
    )
  })
}

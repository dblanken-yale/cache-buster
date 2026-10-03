import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const CELLS = 20

const lastAt = atom({ plugin: 'cache-buster', key: 'lastAt' } as const, null)
const hitRate = atom({ plugin: 'cache-buster', key: 'hitRate' } as const, 0)
const now = atom({ plugin: 'cache-buster', key: 'now' } as const, 0)

export const register: Register = (on, options) => {
  const ttl = Number(options.cacheMinutes) || 60
  const warn = Math.max(1, Math.round(ttl / 12))
  let warned = false

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
    if (e.reason === 'clear') {
      await update($, lastAt, () => null)
      warned = false
    }
    return next(e)
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
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const at = await read($, lastAt)
    if (e.props.hasSurvey || at === null) return next(e)

    const ageMin = Math.max(0, Math.floor(((await read($, now)) - at) / 60_000))
    const leftMin = Math.max(0, ttl - ageMin)
    const filled = Math.round((leftMin / ttl) * CELLS)
    const color = leftMin <= warn ? 'red' : leftMin <= ttl / 4 ? 'yellow' : 'green'
    const rate = Math.round((await read($, hitRate)) * 100)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text color={color}>● </Text>
        <Text>
          cache {leftMin === 0 ? 'expired' : `${leftMin}m left`} {'█'.repeat(filled)}
          {'░'.repeat(CELLS - filled)} {rate}% hit{' '}
        </Text>
        <Button
          key="compact"
          label="Compact"
          onPress={() =>
            $.session.compact().then(
              async r => {
                if (r.skip) $.ui.toast(`Compact skipped: ${r.skip}`)
                else await update($, lastAt, () => null)
              },
              (err: unknown) => $.ui.toast(err instanceof Error ? err.message : String(err)),
            )
          }
        />
      </Box>
    )
  })
}

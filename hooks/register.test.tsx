import { expect, test } from 'claude-code/testing'

const BAND = { plugin: 'cache-buster', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`stacks the bands beneath under the cache bar (${surface})`, async ($, on) => {
    // The test's hooks sit beneath the plugin: this stands for another mod's band.
    on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'other mod row') as never)
    on('clock.now', () => ({ value: 1_000_000 }) as never)
    on('session.usage', () => ({ value: { context: { window: 100 } } }) as never)
    on('turn.step', async function* () {
      return {
        turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn',
        usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0, output_tokens: 1 },
      } as never
    })

    // Before the first reply the bar is hidden and the band beneath shows alone.
    const before = await $.ui.mount({ ...BAND, surface } as never)
    expect(await before.findAll({ text: /cache/ })).toEqual([])
    expect(await before.find({ text: /other mod row/ })).toBeTruthy()
    await before.unmount()

    for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 } as never)) { /* drain */ }

    const after = await $.ui.mount({ ...BAND, surface } as never)
    expect(await after.find({ text: /90% hit/ })).toBeTruthy()
    expect(await after.find({ text: /0k ctx/ })).toBeTruthy()
    expect(await after.find({ text: /other mod row/ })).toBeTruthy()
  })
}

test('ctx turns red at 80% of the window', async ($, on) => {
  on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'x') as never)
  on('clock.now', () => ({ value: 1_000_000 }) as never)
  on('session.usage', () => ({ value: { context: { window: 100 } } }) as never)
  on('turn.step', async function* () {
    return {
      turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn',
      usage: { input_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 },
    } as never
  })
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 } as never)) { /* drain */ }
  const m = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  // find returns the enclosing Box, so match the ctx Text's props in the serialized tree.
  expect(JSON.stringify(await m.find({ text: /0k ctx/ }))).toContain('"color":"red","dimColor":false},"children":["0","k ctx"')
})

test('Compact pressed mid-turn waits for turn.complete', async ($, on) => {
  let calls = 0
  on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'x') as never)
  on('clock.now', () => ({ value: 1_000_000 }) as never)
  on('session.usage', () => ({ value: { context: { window: 100 } } }) as never)
  on('ui.toast', () => ({}) as never)
  on('session.compact', () => {
    calls++
    return { skip: 'test' } as never
  })
  on('turn.complete', () => ({ text: '' }) as never)
  on('turn.step', async function* () {
    return {
      turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn',
      usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0, output_tokens: 1 },
    } as never
  })
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 } as never)) { /* drain */ }

  const m = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true }, surface: 'terminal' } as never)
  await m.press({ key: 'compact' } as never)
  expect(calls).toBe(0)

  await $.turn.complete({ turnId: 't', answer: '' } as never)
  expect(calls).toBe(1)
})

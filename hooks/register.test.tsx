import { expect, mock, test } from 'claude-code/testing'

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
  on('ui.toast', () => ({ value: undefined }) as never)
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
  on('clock.every', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 } as never)) { /* drain */ }

  const m = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true }, surface: 'terminal' } as never)
  await m.press({ key: 'compact' } as never)
  expect(calls).toBe(0)

  await $.turn.complete({ turnId: 't', answer: '' } as never)
  expect(calls).toBe(1)
})

for (const isInteractive of [true, false]) {
  test(`Compact shows only in an interactive session (${isInteractive})`, async ($, on) => {
    on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'x') as never)
    on('clock.now', () => ({ value: 1_000_000 }) as never)
    on('clock.every', () => ({ value: undefined }) as never)
    on('session.usage', () => ({ value: { context: { window: 100 } } }) as never)
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    on('turn.step', async function* () {
      return {
        turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn',
        usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0, output_tokens: 1 },
      } as never
    })
    await $.session.start({ cwd: '/', surface: null, isInteractive })
    for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 } as never)) { /* drain */ }

    const m = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
    expect(await m.find({ text: /90% hit/ })).toBeTruthy()
    expect(JSON.stringify(await m.find({ text: /90% hit/ })).includes('"compact"')).toBe(isInteractive)
  })
}

for (const isInteractive of [true, false]) {
  test(`near expiry, hints at /compact only in a headless session (${isInteractive})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const toasts: string[] = []
    on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'x') as never)
    on('ui.toast', (_, e) => {
      toasts.push((e as { text: string }).text)
      return { value: undefined } as never
    })
    on('session.usage', () => ({ value: { context: { window: 100 } } }) as never)
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    on('turn.step', async function* () {
      return {
        turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn',
        usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0, output_tokens: 1 },
      } as never
    })
    await $.session.start({ cwd: '/', surface: null, isInteractive })
    for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 } as never)) { /* drain */ }

    const green = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
    expect(await green.findAll({ text: /type \/compact/ })).toEqual([])
    await green.unmount()

    await clock.advance(56 * 60_000)
    expect(toasts).toEqual([`Cache expires in ~5m. ${isInteractive ? 'Compact' : 'Type /compact'} or send something.`])
    const red = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
    expect((await red.findAll({ text: /type \/compact/ })).length > 0).toBe(!isInteractive)
  })
}

// Background check-in: one main turn, then Stop with a snapshot, then turn.complete arms the timer.
const STEP = {
  turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn',
  usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0, output_tokens: 1 },
}
const TASK = { id: 'b1', type: 'shell', status: 'running', description: 'build the thing' }

async function mainTurn($: any, bgTasks: unknown[]) {
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 } as never)) { /* drain */ }
  await $.classic.Stop({ stop_hook_active: false, background_tasks: bgTasks } as never)
  await $.turn.complete({ turnId: 't', answer: '' } as never)
}

function setup(on: any, agents: unknown[] = []) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const prompts: string[] = []
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: { context: { window: 100 } } }) as never)
  on('agent.list', () => ({ value: agents }) as never)
  on('classic.Stop', () => ({}) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('turn.step', async function* () { return STEP as never })
  on('prompt.submit', (_: unknown, e: { text: string }) => {
    prompts.push(e.text)
    return { text: e.text } as never
  })
  return { clock, prompts }
}

test('check-in fires at 56m on the 60m cache while a background task runs', async ($, on) => {
  const { clock, prompts } = setup(on)
  await mainTurn($, [TASK])
  await clock.advance(55 * 60_000)
  expect(prompts).toEqual([])
  await clock.advance(60_000)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('build the thing')
})

test('no check-in when nothing is running', async ($, on) => {
  const { clock, prompts } = setup(on)
  await mainTurn($, [])
  await clock.advance(57 * 60_000)
  expect(prompts).toEqual([])
})

test('a running agent from agent.list alone triggers the check-in', async ($, on) => {
  const { clock, prompts } = setup(on, [
    { id: 'a1', description: 'review the diff', type: 'subagent', status: 'running' },
    { id: 'a2', description: 'old job', type: 'subagent', status: 'completed' },
  ])
  await mainTurn($, [])
  await clock.advance(56 * 60_000)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('review the diff')
  expect(prompts[0]).not.toContain('old job')
})

test('5m cache checks in at 4m, not 3m', { options: { cacheMinutes: '5' } }, async ($, on) => {
  const { clock, prompts } = setup(on)
  await mainTurn($, [TASK])
  await clock.advance(3 * 60_000)
  expect(prompts).toEqual([])
  await clock.advance(60_000)
  expect(prompts.length).toBe(1)
})

test('checkIn off submits nothing', { options: { checkIn: 'off' } }, async ($, on) => {
  const { clock, prompts } = setup(on)
  await mainTurn($, [TASK])
  await clock.advance(60 * 60_000)
  expect(prompts).toEqual([])
})

test('a new main turn cancels the pending check-in', async ($, on) => {
  const { clock, prompts } = setup(on)
  await mainTurn($, [TASK])
  await clock.advance(30 * 60_000)
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 2 } as never)) { /* drain */ }
  await clock.advance(30 * 60_000)
  expect(prompts).toEqual([])
})

test('agents another plugin or a subagent started do not trigger the check-in', async ($, on) => {
  const { clock, prompts } = setup(on, [
    { id: 'a1', description: 'plugin job', type: 'subagent', status: 'running', spawnedBy: 'other-plugin' },
    { id: 'a2', description: 'child job', type: 'subagent', status: 'running', parentId: 'x' },
  ])
  await mainTurn($, [])
  await clock.advance(56 * 60_000)
  expect(prompts).toEqual([])
})

test('a plugin-owned agent in both the snapshot and agent.list does not trigger the check-in', async ($, on) => {
  const { clock, prompts } = setup(on, [
    { id: 'a1', description: 'plugin job', type: 'subagent', status: 'running', spawnedBy: 'other-plugin' },
  ])
  await mainTurn($, [{ id: 'a1', type: 'subagent', status: 'running', description: 'plugin job' }])
  await clock.advance(56 * 60_000)
  expect(prompts).toEqual([])
})

test('a snapshot subagent that agent.list reports completed does not trigger the check-in', async ($, on) => {
  const { clock, prompts } = setup(on, [
    { id: 'a1', description: 'done job', type: 'subagent', status: 'completed' },
  ])
  await mainTurn($, [{ id: 'a1', type: 'subagent', status: 'running', description: 'done job' }])
  await clock.advance(56 * 60_000)
  expect(prompts).toEqual([])
})

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
  test(`Compact shows in every session, and falls back to /compact where compact() is refused (${isInteractive})`, async ($, on) => {
    const ran: string[] = []
    on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'x') as never)
    on('clock.now', () => ({ value: 1_000_000 }) as never)
    on('clock.every', () => ({ value: undefined }) as never)
    on('session.usage', () => ({ value: { context: { window: 100 } } }) as never)
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    on('session.compact', () => {
      if (!isInteractive) throw new Error('compact is not available in this session')
      return { skip: 'test' } as never
    })
    on('command.run', (_$, e) => {
      ran.push(String((e as { command?: string }).command))
      return { text: '' } as never
    })
    on('turn.step', async function* () {
      return {
        turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn',
        usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0, output_tokens: 1 },
      } as never
    })
    await $.session.start({ cwd: '/', surface: null, isInteractive })
    for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 } as never)) { /* drain */ }

    const m = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
    expect(JSON.stringify(await m.find({ text: /90% hit/ })).includes('"compact"')).toBe(true)
    await m.press({ key: 'compact' } as never)
    expect(ran).toEqual(isInteractive ? [] : ['compact'])
  })
}

for (const isInteractive of [true, false]) {
  test(`near expiry, toasts to compact in every session (${isInteractive})`, async ($, on) => {
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

    await clock.advance(56 * 60_000)
    expect(toasts).toEqual(['Cache expires in ~5m. Compact or send something.'])
  })
}

// Background check-in: a main turn launches background work through tool.call, then
// turn.complete arms the timer. Stop is never hooked (see the README).
const STEP = {
  turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn',
  usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0, output_tokens: 1 },
}
const SHELL = { tool: 'Bash', command: 'make', description: 'build the thing', run_in_background: true }

async function mainTurn($: any, calls: unknown[] = []) {
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 } as never)) { /* drain */ }
  for (const c of calls) await $.tool.call(c as never)
  await $.turn.complete({ turnId: 't', answer: '' } as never)
}

// lsof answers with `held` for each output file: a pid while the shell runs, '' once it ended
// (exit 1), or '' with another exit code when lsof itself failed.
function setup(on: any, agents: unknown[] = [], held: { stdout: string; exitCode?: number } = { stdout: '123\n' }) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const prompts: string[] = []
  const lsof: string[][] = []
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: { context: { window: 100 } } }) as never)
  on('agent.list', () => ({ value: agents }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('turn.start', (_: unknown, e: { turnId?: string }) => ({ turnId: e.turnId ?? 't2' }) as never)
  on('turn.step', async function* () { return STEP as never })
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    lsof.push(e.argv)
    return { value: { exitCode: held.exitCode ?? (held.stdout ? 0 : 1), stdout: held.stdout, stderr: '' } } as never
  })
  on('tool.call', (_: unknown, e: { tool: string; run_in_background?: boolean; persistent?: boolean }) => {
    if (e.tool === 'Bash' && e.run_in_background) {
      return {
        result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' },
        text: 'Output is being written to: /tmp/x/b1.output',
      } as never
    }
    if (e.tool === 'Monitor') {
      return { result: e.persistent ? { taskId: 'm1', timeoutMs: 0, persistent: true } : { taskId: 'm1', timeoutMs: 600_000 } } as never
    }
    return { result: {} } as never
  })
  on('prompt.submit', (_: unknown, e: { text: string }) => {
    prompts.push(e.text)
    return { text: e.text } as never
  })
  return { clock, prompts, lsof }
}

test('check-in fires at 56m on the 60m cache while a background task runs', async ($, on) => {
  const { clock, prompts, lsof } = setup(on)
  await mainTurn($, [SHELL])
  await clock.advance(55 * 60_000)
  expect(prompts).toEqual([])
  await clock.advance(60_000)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('build the thing (shell)')
  expect(lsof).toEqual([['lsof', '-t', '--', '/tmp/x/b1.output']])
})

test('no check-in when nothing is running', async ($, on) => {
  const { clock, prompts } = setup(on)
  await mainTurn($, [{ tool: 'Bash', command: 'ls', description: 'list files' }])
  await clock.advance(57 * 60_000)
  expect(prompts).toEqual([])
})

test('a finished task stops the check-in', async ($, on) => {
  const { clock, prompts } = setup(on)
  await mainTurn($, [SHELL])
  await clock.advance(10 * 60_000)
  await $.turn.start({
    turnId: 't2',
    text: '<task-notification><task-id>b1</task-id><status>completed</status><summary>done</summary></task-notification>',
  } as never)
  await mainTurn($)
  await clock.advance(57 * 60_000)
  expect(prompts).toEqual([])
})

test('a monitor event that is not its end keeps the check-in', async ($, on) => {
  const { clock, prompts } = setup(on)
  await mainTurn($, [{ tool: 'Monitor', command: 'tail -f log', description: 'watch the log', persistent: true }])
  await $.turn.start({ turnId: 't2', text: '<task-notification><task-id>m1</task-id><event>line</event></task-notification>' } as never)
  await mainTurn($)
  await clock.advance(56 * 60_000)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('watch the log (monitor)')
})

test('a turn carrying several notifications ends only the tasks that ended', async ($, on) => {
  const { clock, prompts } = setup(on)
  await mainTurn($, [SHELL, { tool: 'Monitor', command: 'tail -f log', description: 'watch the log', persistent: true }])
  await $.turn.start({
    turnId: 't2',
    text:
      '<task-notification><task-id>b1</task-id><status>completed</status></task-notification>\n' +
      '<task-notification><task-id>m1</task-id><event>line</event></task-notification>',
  } as never)
  await mainTurn($)
  await clock.advance(56 * 60_000)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('watch the log (monitor)')
  expect(prompts[0]).not.toContain('build the thing')
})

test('an lsof that fails outright does not end the shell', async ($, on) => {
  const { clock, prompts } = setup(on, [], { stdout: '', exitCode: 2 })
  await mainTurn($, [SHELL])
  await clock.advance(56 * 60_000)
  expect(prompts.length).toBe(1)
})

test('a monitor past its time limit does not trigger the check-in', async ($, on) => {
  const { clock, prompts } = setup(on)
  await mainTurn($, [{ tool: 'Monitor', command: 'tail -f log', description: 'watch the log', timeout_ms: 600_000 }])
  await clock.advance(56 * 60_000)
  expect(prompts).toEqual([])
})

test('TaskStop stops the check-in', async ($, on) => {
  const { clock, prompts } = setup(on)
  await mainTurn($, [SHELL, { tool: 'TaskStop', task_id: 'b1' }])
  await clock.advance(56 * 60_000)
  expect(prompts).toEqual([])
})

test('a shell whose output file nothing holds open does not trigger the check-in', async ($, on) => {
  const { clock, prompts } = setup(on, [], { stdout: '' })
  await mainTurn($, [SHELL])
  await clock.advance(56 * 60_000)
  expect(prompts).toEqual([])
})

test('compact keeps the tracked work', async ($, on) => {
  const { clock, prompts } = setup(on)
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }) as never)
  await mainTurn($, [SHELL])
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never)
  await mainTurn($)
  await clock.advance(56 * 60_000)
  expect(prompts.length).toBe(1)
})

test('a running agent from agent.list alone triggers the check-in', async ($, on) => {
  const { clock, prompts } = setup(on, [
    { id: 'a1', description: 'review the diff', type: 'subagent', status: 'running' },
    { id: 'a2', description: 'old job', type: 'subagent', status: 'completed' },
  ])
  await mainTurn($)
  await clock.advance(56 * 60_000)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('review the diff')
  expect(prompts[0]).not.toContain('old job')
})

test('5m cache checks in at 4m, not 3m', { options: { cacheMinutes: '5' } }, async ($, on) => {
  const { clock, prompts } = setup(on)
  await mainTurn($, [SHELL])
  await clock.advance(3 * 60_000)
  expect(prompts).toEqual([])
  await clock.advance(60_000)
  expect(prompts.length).toBe(1)
})

test('checkIn off submits nothing', { options: { checkIn: 'off' } }, async ($, on) => {
  const { clock, prompts } = setup(on)
  await mainTurn($, [SHELL])
  await clock.advance(60 * 60_000)
  expect(prompts).toEqual([])
})

test('a new main turn cancels the pending check-in', async ($, on) => {
  const { clock, prompts } = setup(on)
  await mainTurn($, [SHELL])
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
  await mainTurn($)
  await clock.advance(56 * 60_000)
  expect(prompts).toEqual([])
})

test('ctx is yellow from 100k and red past 150k', async ($, on) => {
  let used = 110_000
  on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'x') as never)
  on('clock.now', () => ({ value: 1_000_000 }) as never)
  on('session.usage', () => ({ value: { context: { window: 1_000_000 } } }) as never)
  on('turn.step', async function* (_$, e) {
    return {
      turnId: 't', index: e.index, answer: '', toolUses: [], stopReason: 'end_turn',
      usage: { input_tokens: used, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 },
    } as never
  })
  const colorAt = async (index: number, tokens: number) => {
    used = tokens
    for await (const _ of $.turn.step({ turnId: 't', index, model: 'm', messageCount: 1 } as never)) { /* drain */ }
    const m = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
    return JSON.stringify(await m.find({ text: /k ctx/ }))
  }
  expect(await colorAt(0, 110_000)).toContain('"color":"yellow"')
  expect(await colorAt(1, 160_000)).toContain('"color":"red"')
})

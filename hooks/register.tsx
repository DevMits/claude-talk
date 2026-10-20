import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Pos, Status } from '../types'

// Kokoro runs in its own Python 3.12 venv; say.py (see kokoro/say.py) writes one wav per chunk.
const KOKORO_DIR = `${process.env.HOME}/.local/share/kokoro`
const KOKORO_PY = `${KOKORO_DIR}/.venv/bin/python`
const KOKORO_SAY = `${KOKORO_DIR}/say.py`
const VOICE = 'af_heart'
const WAIT_MS = 90_000

type Proc = { run: (argv: string[], opts?: any) => Promise<any>; spawn: (opts: any) => any }
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]
const MAX_CHUNK = 240

const statusAtom = atom({ plugin: 'talk', key: 'status' } as const, 'idle' as Status)
const speedAtom = atom({ plugin: 'talk', key: 'speed' } as const, 1)
const posAtom = atom({ plugin: 'talk', key: 'pos' } as const, { i: 0, n: 0 } as Pos)

// Reply text to speakable chunks: no code blocks, links or markdown marks.
export const toChunks = (answer: string): string[] => {
  const text = answer
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/[`*_>~]/g, '')
  const sentences = text
    .split(/\n+|(?<=[.!?:])\s+/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => /[A-Za-z0-9]/.test(s))
  const chunks: string[] = []
  for (const s of sentences) {
    const last = chunks[chunks.length - 1]
    if (last !== undefined && last.length + s.length < MAX_CHUNK) chunks[chunks.length - 1] = `${last} ${s}`
    else chunks.push(s)
  }
  return chunks
}

// On/off lives in $.store, so it carries across sessions. Default: on.
const isOn = async ($: EngineInterface): Promise<boolean> => (await $.store.get('muted')) !== true

export const register: Register = on => {
  let chunks: string[] = []
  let idx = 0
  let gen = 0
  let speed = 1
  let isPlaying = false
  let kills = 0
  let wake: (() => void) | null = null
  let current: AsyncGenerator<unknown> | null = null
  let worker: AsyncGenerator<unknown> | null = null
  let workerDone = true
  let wGen = -1
  let wSpeed = 0
  let wFrom = 0
  let dir = ''

  const poke = () => {
    const w = wake
    wake = null
    w?.()
  }
  const killCurrent = async () => {
    kills += 1
    const c = current
    current = null
    await c?.return(undefined).catch(() => {})
  }
  const killWorker = async () => {
    const w = worker
    worker = null
    await w?.return(undefined).catch(() => {})
  }
  // The mod sandbox has no file access of its own, so files go through small shell commands.
  const exists = async (proc: Proc, f: string) => (await proc.run(['test', '-f', f]).catch(() => null))?.exitCode === 0
  // Makes sure a Kokoro worker is preparing chunks from `from` at `at` speed; restarts it if not.
  const ensureWorker = async (proc: Proc, my: number, from: number, at: number) => {
    const reuse = worker && !workerDone && wGen === my && wSpeed === at && wFrom <= from
    if (reuse) return
    if (wGen === my && wSpeed === at && wFrom <= from && (await exists(proc, `${dir}/${from}.wav`))) return
    await killWorker()
    wGen = my
    wSpeed = at
    wFrom = from
    dir = `/tmp/talk-${my}-${at}-${from}`
    await proc.run(['sh', '-c', 'mkdir -p "$1" && cat > "$1/chunks.json"', 'sh', dir], { stdin: JSON.stringify(chunks) })
    workerDone = false
    const w = proc.spawn({ argv: [KOKORO_PY, KOKORO_SAY, `${dir}/chunks.json`, dir, String(at), VOICE, String(from)] }) as AsyncGenerator<unknown>
    worker = w
    void (async () => {
      try {
        for await (const _ of w) void _
      } catch {}
      if (worker === w) workerDone = true
    })()
  }
  // Controls only flip flags; the reading loop (below) obeys them.
  const ctl = {
    pause: async () => {
      isPlaying = false
      await killCurrent()
    },
    resume: () => {
      isPlaying = true
      poke()
    },
    replay: async () => {
      idx = 0
      isPlaying = true
      await killCurrent()
      poke()
    },
    speed: async (v: number) => {
      speed = v
      await killWorker()
      if (isPlaying) await killCurrent()
    },
    cancel: async () => {
      gen += 1
      isPlaying = false
      await killCurrent()
      await killWorker()
      poke()
    },
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'talk',
      description: 'talk: turn reading aloud on or off',
      argumentHint: '[on|off]',
    })
    return next(e)
  })

  on('command.run', { command: 'talk' }, async ($, e) => {
    const cmd = e.args.trim().toLowerCase()
    if (cmd === 'on' || cmd === 'off') {
      await $.store.set('muted', cmd === 'off')
      if (cmd === 'off') {
        await ctl.cancel()
        await update($, statusAtom, () => 'idle')
      }
      return { text: `talk is now: ${cmd}` }
    }
    return { text: `talk is ${(await isOn($)) ? 'on' : 'off'}. Use /talk on or /talk off.` }
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || e.isAborted || !(await isOn($))) return r
    const found = toChunks(e.answer)
    if (found.length === 0) return r

    await ctl.cancel()
    chunks = found
    idx = 0
    speed = await read($, speedAtom)
    isPlaying = true
    const my = gen
    // The mod loader only allows $ to be used as $.noun.event(...), so helpers get this wrapper instead.
    const proc: Proc = { run: (a, o) => $.process.run(a, o), spawn: o => $.process.spawn(o) }

    void (async () => {
      while (my === gen) {
        if (idx >= chunks.length || !isPlaying) {
          isPlaying = false
          await update($, posAtom, () => ({ i: Math.min(idx, chunks.length - 1), n: chunks.length }))
          await update($, statusAtom, () => (idx >= chunks.length ? 'done' : 'paused'))
          await new Promise<void>(res => {
            wake = res
          })
          continue
        }
        await update($, statusAtom, () => 'playing')
        await update($, posAtom, () => ({ i: idx, n: chunks.length }))
        const text = chunks[idx]!
        const k = kills
        let wav = ''
        try {
          await ensureWorker(proc, my, idx, speed)
          const want = `${dir}/${idx}.wav`
          const until = Date.now() + WAIT_MS
          while (my === gen && k === kills && !(await exists(proc, want))) {
            if (workerDone || Date.now() > until) break
            await new Promise(res => setTimeout(res, 100))
          }
          if (await exists(proc, want)) wav = want
        } catch {}
        if (my !== gen || k !== kills) continue
        const ok = wav !== ''
        const player = $.process.spawn({
          argv: ok ? ['pw-play', wav] : ['espeak-ng', '-s', String(Math.round(165 * speed)), text],
        })
        current = player
        try {
          for await (const _ of player) void _
        } catch {}
        if (current === player) current = null
        if (my === gen && k === kills) idx += 1
      }
    })()

    return r
  })

  on('prompt.submit', async ($, e, next) => {
    if (isPlaying) {
      await ctl.cancel()
      await update($, statusAtom, () => 'done')
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const status = await read($, statusAtom)
    if (status === 'idle' || e.props.hasSurvey) return next(e)
    const pos = await read($, posAtom)
    const now = await read($, speedAtom)
    const { Box, Text, Button } = $.ui.resolve(e)
    const label =
      status === 'playing' ? `Reading ${pos.i + 1}/${pos.n}` : status === 'paused' ? `Paused ${pos.i + 1}/${pos.n}` : 'Finished'

    return (
      <Box>
        <Text dimColor>🔊 {label}  </Text>
        {status === 'paused' ? (
          <Button
            key="resume"
            label="Resume"
            hotkey="p"
            onPress={async () => {
              ctl.resume()
              await update($, statusAtom, () => 'playing')
            }}
          />
        ) : status === 'playing' ? (
          <Button
            key="pause"
            label="Pause"
            hotkey="p"
            onPress={async () => {
              await ctl.pause()
              await update($, statusAtom, () => 'paused')
            }}
          />
        ) : null}
        <Button
          key="replay"
          label="Replay"
          hotkey="r"
          onPress={async () => {
            await ctl.replay()
            await update($, statusAtom, () => 'playing')
          }}
        />
        <Text dimColor>  Speed </Text>
        {SPEEDS.map(v => (
          <Button
            key={`speed-${v}`}
            plain
            label={v === now ? '●' : '○'}
            onPress={async () => {
              await ctl.speed(v)
              await update($, speedAtom, () => v)
            }}
          />
        ))}
        <Text> {now}x</Text>
      </Box>
    )
  })
}

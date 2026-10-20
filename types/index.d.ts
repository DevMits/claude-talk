export type Status = 'idle' | 'playing' | 'paused' | 'done'
export type Pos = { i: number; n: number }

declare module 'claude-code' {
  interface PluginState {
    'talk': { status: Status; speed: number; pos: Pos }
  }
}

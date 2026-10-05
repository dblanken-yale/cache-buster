declare module 'claude-code' {
  interface PluginState {
    'cache-buster': {
      /** Epoch ms of the last main-thread request; null before the first. */
      lastAt: number | null
      /** Cache hit rate of that request, 0 to 1. */
      hitRate: number
      /** Input tokens of that request: the conversation's context size. */
      context: number
      /** Epoch ms, refreshed every minute so the band redraws. */
      now: number
    }
  }
}

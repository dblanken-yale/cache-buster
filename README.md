# cache-buster

A Claude Code mod that shows how much time is left on the prompt cache, so you can keep a session going (or compact it) before the cache expires.

```
● cache 56m left ███████████████████░ 98% hit [Compact]
```

## Why

Claude Code caches your conversation between requests, for an hour or for five minutes depending on your account (see [Which cache length you have](#which-cache-length-you-have)). While the cache is warm, each new message reads the conversation back from the cache at a tenth of the normal input price or less, so it is at least 90% cheaper (95% on Opus 5.5).

If you go longer than that without sending anything, the cache expires. Your next message has to write the whole conversation back into the cache, which costs twice the normal input price on the 1-hour cache. That one message costs about 20 times what it would have with a warm cache (40 times on Opus 5.5), and the more context you have built up, the bigger that bill.

This mod shows how long you have before that happens. If you have a long session going and know you'll be away past the hour, press Compact first. The conversation shrinks to a short summary, so the message that starts it up again is cheap.

Prices are from the [Claude pricing page](https://platform.claude.com/docs/en/about-claude/pricing#prompt-caching), checked 2026-10-02.

## What it shows

- **Time left:** each request to the model refreshes the cache. The bar starts full after a request and drains to empty over the cache length (60 minutes by default).
- **Dot color:** green, then yellow in the last quarter of the cache, then red in the last 5 minutes on the 1-hour cache (last 1 minute on the 5-minute cache).
- **Hit rate:** the share of the last request's input tokens that were read from the cache.
- **Warning:** a popup at the same point as red (5 minutes left, or 1 minute on the 5-minute cache) says the cache is about to expire.
- **Compact:** runs the same thing as `/compact`.

Subagent requests don't count, since they don't refresh the main conversation's cache.

## Which cache length you have

From [How Claude Code uses prompt caching](https://code.claude.com/docs/en/prompt-caching#which-ttl-each-request-gets), checked 2026-10-02:

| How you use Claude Code | Main conversation cache |
| --- | --- |
| Claude subscription, within your plan's included usage | 1 hour |
| Claude subscription after you go over your plan's limit and draw on usage credits | 5 minutes |
| API key | 5 minutes |
| Amazon Bedrock, Google Cloud, or Microsoft Foundry | 5 minutes |

You can override the default with the `promptCacheTtl` setting (`"5m"` or `"1h"`) in `~/.claude/settings.json`, or the `CLAUDE_CODE_PROMPT_CACHE_TTL` environment variable. Both need Claude Code v2.1.242 or later. `FORCE_PROMPT_CACHING_5M=1` forces five minutes, and `ENABLE_PROMPT_CACHING_1H=1` asks for an hour.

If you're on the 5-minute cache, set cache-buster's cache length to 5 (see [Notes](#notes)). The mod can't detect which one you have, so it won't notice if a subscription switches to 5 minutes partway through a session because you went over your plan's limit.

To check which one your sessions use, run this and look at `usage.cache_creation`. Tokens under `ephemeral_1h_input_tokens` mean the 1-hour cache, and tokens under `ephemeral_5m_input_tokens` mean the 5-minute cache.

```bash
claude -p "hello" --output-format json
```

## Install

1. Clone the repo into your mods folder:

   ```bash
   git clone git@github.com:dblanken-yale/cache-buster.git ~/.claude/mods/cache-buster
   ```

2. Add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`:

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/cache-buster"
     }
   }
   ```

   If the variable already lists other folders, add this one with a `:` between them, for example `"~/.claude/mods/statusline:~/.claude/mods/cache-buster"`.

3. Start a new Claude Code session, in the terminal or the desktop app. The row appears above the prompt after the first reply.

To try it in one terminal session without changing settings:

```bash
claude --plugin-dir ~/.claude/mods/cache-buster
```

## Update

```bash
git -C ~/.claude/mods/cache-buster pull
```

Terminal sessions reload the mod when its files change. Desktop app sessions pick it up when you start a new one.

## Notes

- The mod assumes a 1-hour cache by default. If you're on the 5-minute cache (see [Which cache length you have](#which-cache-length-you-have)), set the cache length to 5 in the plugin's row in the config menu, or in `~/.claude/settings.json`:

  ```json
  { "pluginConfigs": { "cache-buster": { "options": { "cacheMinutes": "5" } } } }
  ```

  The display updates once a minute, so the 5-minute cache is coarse.
- To check it after editing: `claude plugin validate ~/.claude/mods/cache-buster`.
- `tsconfig.json` points at `.claude-plugin/types/`, which Claude Code generates and git ignores, so type-checking a fresh clone needs those files regenerated first.

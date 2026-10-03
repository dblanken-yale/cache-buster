# cache-buster

A Claude Code mod that shows how much time is left on the prompt cache, so you can keep a session going (or compact it) before the cache expires.

```
● cache 56m left ███████████████████░ 98% hit [Compact]
```

## Why

Claude Code caches your conversation for up to an hour between requests. While the cache is warm, each new message reads the conversation back from the cache at about a tenth of the normal input price, so it is roughly 90% cheaper.

If you go more than an hour without sending anything, the cache expires. Your next message pays full price for the whole conversation again, plus the cost of writing it back to the cache. The more context you have built up, the more that one message costs.

This mod shows how long you have before that happens. If you have a long session going and know you'll be away past the hour, press Compact first. The conversation shrinks to a short summary, so the message that starts it up again is cheap.

- **Time left:** each request to the model refreshes the cache. The bar starts full after a request and drains to empty over 60 minutes.
- **Dot color:** green, then yellow from 45m used, then red from 55m used.
- **Hit rate:** the share of the last request's input tokens that were read from the cache.
- **Warning:** a popup at 55m says the cache is about to expire.
- **Compact:** runs the same thing as `/compact`.

Subagent requests don't count, since they don't refresh the main conversation's cache.

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

- The mod assumes a 1-hour cache lifetime. If your sessions use the 5-minute cache, change `TTL_MIN` in `hooks/register.tsx`.
- To check it after editing: `claude plugin validate ~/.claude/mods/cache-buster`.
- `tsconfig.json` points at `.claude-plugin/types/`, which Claude Code generates and git ignores, so type-checking a fresh clone needs those files regenerated first.

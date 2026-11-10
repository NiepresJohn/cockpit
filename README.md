# Cockpit

A live session card that sits above the Claude Code prompt. It shows what the session is doing and how much headroom you have left, without leaving the terminal.

A mod for Claude Code, written in TypeScript and React (Ink).

## What it shows

- **Header:** model, effort gauge, repo, branch, uncommitted diff (`+add −del`, or `✓ clean`) and commits ahead/behind upstream.
- **Activity line:** a spinner plus what the model is doing right now (`$ npm test`, `Edit hooks/lib.ts`). Secrets such as bearer tokens are redacted.
- **Meters:** 5-hour and 7-day limits with a reset countdown, context left with a short history sparkline, cost, turn timer, and run stats (turns, tool calls, edits). Bars use eighth-block gradients and pulse above 85%.
- **Agents:** while subagents run, one row each with a clock and its latest tool call. Finished agents stay briefly, newest first.
- **Toasts:** a notification when a limit crosses 85% or 95%.

## Layout by width

| Terminal width | Card |
|---|---|
| under 64 columns | a single line |
| 64–83 | full card, effort gauge hidden |
| 84–109 | full card with effort gauge |
| 110 and up | bars stretch to use the room |

## Install

Requires a Claude Code build with mod support. Developed and tested on 2.1.304.

In Claude Code:

```
/plugin marketplace add NiepresJohn/cockpit
/plugin install cockpit@cockpit
```

Or from a shell:

```sh
claude plugin marketplace add NiepresJohn/cockpit
claude plugin install cockpit@cockpit
```

Start a new session, or run `/reload-plugins` in a running one. The card opens on start; see Settings to change that. Both options are optional and have defaults, so no configuration is needed.

Update with `claude plugin marketplace update cockpit`. Remove with `claude plugin uninstall cockpit`.

## Commands

`/cockpit [open|close|reset|demo]`

| Verb | Effect |
|---|---|
| `open` | Show the card (default). |
| `close` | Hide it. |
| `reset` | Clear tracked state: agents, history, stats. |
| `demo` | Load fake data so you can preview the layout. The next real event overwrites parts of it; `reset` clears it. |

## Settings

| Option | Default | Description |
|---|---|---|
| `openOnStart` | on | Open the card when a session starts. |
| `ascii` | off | Plain ASCII only (no block or braille glyphs), for SSH, tmux or limited fonts. |

## Project layout

- `hooks/cockpit.tsx`: hook handlers, state, git polling, pane sizing, the `/cockpit` command.
- `hooks/card.tsx`: the animated card (client module).
- `hooks/lib.ts`: pure helpers (formatting, countdowns, threshold crossing, agent bookkeeping, row math).
- `tests/cockpit.test.ts`: plugin tests.
- `types/index.d.ts`: host API types.

## Develop

```sh
claude plugin validate .
claude plugin test .
```

Card height is computed in two places, `cardRows` in `hooks/lib.ts` and the card itself, so change width thresholds in both.

## License

MIT. See [LICENSE](LICENSE).

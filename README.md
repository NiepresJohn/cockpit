# Cockpit

A live card above the Claude Code prompt.

- Header: model, effort, repo, branch, uncommitted diff.
- Rule line: a spinner and what the model is doing right now (`$ npm test`, `Edit hooks/lib.ts`).
- Meters: 5-hour and 7-day limits (with reset countdown), context left, cost, turn timer and edit count.
- Agents: while subagents run, one row each with a clock and their latest tool call.
- Toast when a limit crosses 85% or 95%.

Under 64 columns it collapses to one line.

## Commands

`/cockpit [open|close|reset]`

## Setting

`openOnStart` (default on).

## Layout

- `hooks/cockpit.tsx`: hook handlers, state, pane sizing.
- `hooks/card.tsx`: the animated card (client module).
- `hooks/lib.ts`: pure helpers.

## Develop

`claude plugin validate .` and `claude plugin test .`

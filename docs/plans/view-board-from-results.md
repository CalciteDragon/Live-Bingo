# Plan: View Board from Results Screen

## Goal

Add a "View Board" button to the results overlay. Clicking it dismisses the overlay so the
player can inspect the final board state. The timer shows the frozen value at match-end (not
continuing to tick). A persistent "View Results" button re-opens the overlay at any time.

---

## Problem Analysis

### Timer is not frozen after completion

`TimerService.getDisplayTimer$` drives its display from `Date.now()` relative to
`timer.startedAt`. When a match completes, `startedAt` is still set and the timer keeps
running:

- **Stopwatch** — ticks upward forever past the match-end time.
- **Countdown (early win)** — keeps counting down below zero (clamped to 00:00) or past the
  win moment.
- **Countdown (timer expiry)** — already at 00:00; no visible problem, but not authoritative.

### No server-side freeze timestamp exists

`TimerState` has `startedAt` but no `stoppedAt`. The client cannot know when the match ended
without it.

### Two server completion paths

1. `applyAndCheckWin()` in `message-pipeline.ts` — handles line/majority wins.
2. `expireCountdown()` in `match-timers.ts` — handles win-by-time.

Both must set `stoppedAt`.

---

## Design Decisions

### Timer freeze: server-authoritative `stoppedAt`

Add `stoppedAt: string | null` to `TimerState`. The server records the ISO timestamp when the
match transitions to `Completed`. `TimerService` returns a static `Observable<string>` when
`stoppedAt` is present rather than a live interval.

This is consistent with the architecture rule: **server is the sole source of truth**. Doing
it client-side (capturing the last emitted value in a signal) would mean two players could
display different frozen values due to local clock drift.

### Toggle state: `showResults` signal in `MatchComponent`

`MatchComponent` owns the layout decision. It already conditionally renders the overlay via
`@if (isCompleted())`. Add a `showResults = signal(true)` that defaults to `true` and is
reset to `true` whenever `isCompleted` transitions to `true`.

`ResultsOverlayComponent` gets a single `@Output() viewBoard` event. It does not know or care
whether it is about to be hidden.

### "View Results" re-entry point

A button rendered in the `match-header` area (next to the timer) when
`isCompleted() && !showResults()`. This keeps it in a predictable, always-visible location
without adding a new layout region.

---

## Affected Files

| File | Change |
|---|---|
| `packages/shared/src/match.ts` | Add `stoppedAt: string \| null` to `TimerState` |
| `apps/api/src/ws/message-pipeline.ts` | Set `timer.stoppedAt = ctx.nowIso` when `winResult !== null` |
| `apps/api/src/ws/match-timers.ts` | Set `timer.stoppedAt = nowIso` in `expireCountdown()` |
| `apps/web/src/app/core/timer.service.ts` | Short-circuit to `of(frozenValue)` when `stoppedAt` is set |
| `apps/web/src/app/shared/results-overlay/results-overlay.ts` | Add `@Output() viewBoard`, add "View Board" button |
| `apps/web/src/app/pages/match/match.ts` | `showResults` signal, effect, conditional rendering, "View Results" button |
| `apps/web/src/styles.scss` | Style "View Results" inline header button |
| `.claude/shared-types.md` | Update `TimerState` docs |
| `.claude/web-client.md` | Update `ResultsOverlayComponent` and `MatchComponent` docs |

---

## Step-by-Step Implementation

### Step 1 — Add `stoppedAt` to `TimerState` (`packages/shared`)

```typescript
export interface TimerState {
  mode: TimerMode;
  startedAt: string | null;
  stoppedAt: string | null;      // ← NEW: ISO 8601, null until match completes
  countdownDurationMs: number | null;
}
```

**Migration note:** Existing `Completed` state snapshots persisted in the DB will not have
`stoppedAt`. Treat `null | undefined` as "live ticking" in `TimerService` — the pre-fix
behaviour is preserved for old snapshots and doesn't regress.

All places that construct a fresh `TimerState` object must set `stoppedAt: null`.

---

### Step 2 — Freeze timer on line/majority win (`apps/api/src/ws/message-pipeline.ts`)

In `applyAndCheckWin`, after checking for a win, stamp `stoppedAt` onto the returned state:

```typescript
function applyAndCheckWin(state, message, ctx) {
  let newState = applyEvent(state, message, ctx);
  const winResult = checkWin(newState) ?? null;
  if (winResult) {
    newState = {
      ...newState,
      status: 'Completed',
      result: winResult,
      timer: { ...newState.timer, stoppedAt: ctx.nowIso },  // ← NEW
    };
  }
  return { newState, winResult };
}
```

`ctx.nowIso` is already the server timestamp used by the engine; re-using it keeps the freeze
instant consistent with other server-side timestamps on the same event.

---

### Step 3 — Freeze timer on countdown expiry (`apps/api/src/ws/match-timers.ts`)

In `expireCountdown`, stamp `stoppedAt` on the completed state:

```typescript
async function expireCountdown(matchId: string): Promise<void> {
  // ...existing guards...
  const nowIso = new Date().toISOString();
  const result = resolveTimerWinner(entry.state);
  const newState = {
    ...entry.state,
    status: 'Completed' as const,
    result,
    timer: { ...entry.state.timer, stoppedAt: nowIso },  // ← NEW
  };
  // ...rest unchanged...
}
```

---

### Step 4 — Update `TimerService` to display frozen time (`apps/web/src/app/core/timer.service.ts`)

```typescript
getDisplayTimer$(timer: TimerState): Observable<string> {
  if (!timer.startedAt) return of('00:00');

  const startMs = Date.parse(timer.startedAt);

  // ← NEW: frozen display for completed matches
  if (timer.stoppedAt) {
    const elapsed = Date.parse(timer.stoppedAt) - startMs;
    if (timer.mode === 'stopwatch') {
      return of(formatMs(Math.max(0, elapsed)));
    } else {
      const remaining = (timer.countdownDurationMs ?? 0) - elapsed;
      return of(formatMs(Math.max(0, remaining)));
    }
  }

  return interval(1000).pipe(
    startWith(0),
    map(() => {
      const elapsed = Date.now() - startMs;
      if (timer.mode === 'stopwatch') {
        return formatMs(Math.max(0, elapsed));
      } else {
        const remaining = (timer.countdownDurationMs ?? 0) - elapsed;
        return formatMs(Math.max(0, remaining));
      }
    }),
  );
}
```

The `stoppedAt` guard is checked before the `interval` branch, so no live subscription is
ever created for a completed match.

---

### Step 5 — Add "View Board" output to `ResultsOverlayComponent`

```typescript
import { Component, computed, inject, output } from '@angular/core';

export class ResultsOverlayComponent {
  readonly viewBoard = output<void>();   // ← NEW

  // ...existing signals unchanged...
}
```

Template addition (visible to **all** players, not just host):

```html
<button class="btn-ghost" (click)="viewBoard.emit()">View Board</button>
```

Place it as the first button in `.results-overlay__actions` (for host) or just above the
"Waiting for host…" paragraph (for non-host), so both players have access.

The updated action section:

```html
@if (amHost()) {
  <div class="results-overlay__actions">
    <button class="btn-ghost" (click)="viewBoard.emit()">View Board</button>
    <button class="btn-primary" (click)="rematch()">Rematch</button>
    <button class="btn-secondary" (click)="backToLobby()">Back to Lobby</button>
  </div>
} @else {
  <div class="results-overlay__actions">
    <button class="btn-ghost" (click)="viewBoard.emit()">View Board</button>
  </div>
  <p class="text-muted results-overlay__waiting">Waiting for host…</p>
}
```

---

### Step 6 — Add `showResults` toggle to `MatchComponent`

New signal and reset effect:

```typescript
readonly showResults = signal(true);

// In constructor, alongside existing effects:
effect(() => {
  if (this.isCompleted()) {
    this.showResults.set(true);  // re-open overlay whenever match completes (rematch flow)
  }
});
```

Template changes — replace the existing `@if (isCompleted())` block:

```html
<div class="match-header">
  <div class="match-timer">{{ displayTimer$ | async }}</div>
  @if (isCompleted() && !showResults()) {
    <button class="btn-ghost match-header__view-results" (click)="showResults.set(true)">
      View Results
    </button>
  }
</div>

<!-- ...match-layout unchanged... -->

@if (isCompleted() && showResults()) {
  <app-results-overlay (viewBoard)="showResults.set(false)" />
}
```

The overlay is no longer rendered (and does not exist in the DOM) when `showResults` is
`false`, giving the player a clean, interactive view of the final board state.

---

### Step 7 — CSS (`apps/web/src/styles.scss`)

Add to the `Match Page` / `Match Header` section:

```scss
.match-header {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1rem;          /* ← was just justify-content:center; add gap+align */
  margin-bottom: 1.25rem;
}

.match-header__view-results {
  font-size: 0.8125rem;
  padding: 0.25rem 0.75rem;
}
```

The `match-header` already uses `display: flex; justify-content: center` — adding
`align-items: center; gap: 1rem` is safe and keeps the timer centred with the button sitting
to its right.

---

### Step 8 — Tests

#### `TimerService` (add to existing spec)

- `stoppedAt` present, stopwatch: returns `of('04:32')` with no live subscription.
- `stoppedAt` present, countdown with `countdownDurationMs`: returns remaining time frozen.
- `stoppedAt` null, stopwatch: still subscribes and ticks (regression guard).

#### Engine tests (`packages/engine`)

Search for any tests that construct a `TimerState` literal and add `stoppedAt: null` to each.
No behaviour change — purely a shape update.

#### API unit tests (`apps/api`)

- `message-pipeline` tests that assert on `newState.timer`: verify `stoppedAt` is set when
  a win is detected, and `null` when the event does not produce a win.
- `match-timers` tests: verify `stoppedAt` is set on the state broadcast by `expireCountdown`.

---

### Step 9 — Update `.claude/` docs

- `.claude/shared-types.md` — add `stoppedAt: string | null` to the `TimerState` block.
- `.claude/web-client.md`:
  - `ResultsOverlayComponent` — document `viewBoard` output and "View Board" button.
  - `MatchComponent` — document `showResults` signal and the conditional overlay rendering.

---

## Out of Scope

- Showing the frozen timer value *inside* the results overlay ("Final time: 04:32") — can be
  added later as a trivial read of `timer.stoppedAt`.
- A countdown animation or visual "freeze" indicator on the timer display.
- Any change to the `match_events` or `matches` DB schema — `stoppedAt` lives only in
  `state_json` (the JSONB snapshot). The existing `ended_at` column on `matches` already
  records the DB-level completion timestamp.

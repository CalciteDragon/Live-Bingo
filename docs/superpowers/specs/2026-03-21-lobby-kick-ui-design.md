# Lobby Kick UI — Design Spec

**Date:** 2026-03-21
**Status:** Approved
**Scope:** `apps/web/src/app/pages/lobby/lobby.ts` + `lobby.spec.ts`

---

## Problem

The server already handles the `KICK_PLAYER` WebSocket intent (including 30-second auto-kick on disconnect), but there is no UI for the host to manually kick a player from the lobby. This spec adds that UI.

---

## Decisions

- Kick button is visible to the host on **all** non-self player cards (connected or not).
- Confirmation is required before sending the intent — a modal dialog is shown.
- Implementation is entirely self-contained within `LobbyComponent`; no new files or CSS are introduced.

---

## Approach

**Inline signal + modal in template** (no new component, no new CSS).

The existing `.modal-backdrop`, `.modal`, `.modal__actions`, `.btn-danger`, and `.btn-ghost` CSS classes cover everything needed. A `playerToKick` signal tracks the pending confirmation state.

---

## Template Changes

### Player card

Add a Kick button inside the `@for` player loop, after the existing badges:

```html
@if (amHost() && !player.isMe) {
  <button class="btn-danger" style="margin-left: auto; padding: 0.25rem 0.75rem; font-size: 0.8125rem" (click)="openKickConfirm(player)">
    Kick
  </button>
}
```

The `margin-left: auto` pushes the button to the right edge of the flex player card without needing a new CSS class.

### Confirmation modal

Rendered at the bottom of the template (outside `.card`), only when `playerToKick()` is non-null:

```html
@if (playerToKick(); as target) {
  <div class="modal-backdrop" (click)="cancelKick()">
    <div class="modal" (click)="$event.stopPropagation()">
      <h2>Kick player?</h2>
      <p>{{ target.alias }} will be removed from the lobby.</p>
      <div class="modal__actions">
        <button class="btn-ghost" (click)="cancelKick()">Cancel</button>
        <button class="btn-danger" (click)="confirmKick()">Kick {{ target.alias }}</button>
      </div>
    </div>
  </div>
}
```

Clicking the backdrop cancels. `stopPropagation` on the inner modal prevents the backdrop click from firing through.

---

## Component Changes

### New signal

```ts
readonly playerToKick = signal<{ playerId: string; alias: string } | null>(null);
```

### New methods

Note: `this.clientId` is a plain `string` (not a signal), assigned via `inject(ClientIdService).clientId`. Pass it directly to `buildClientMessage` without calling it.

```ts
openKickConfirm(player: { playerId: string; alias: string | null | undefined }): void {
  this.playerToKick.set({ playerId: player.playerId, alias: player.alias ?? 'Unknown' });
}

confirmKick(): void {
  const target = this.playerToKick();
  if (!target) return;
  const matchId = this.sessionStore.matchId()!;
  this.socket.send(buildClientMessage('KICK_PLAYER', matchId, this.clientId, { playerId: target.playerId }));
  this.playerToKick.set(null);
}

cancelKick(): void {
  this.playerToKick.set(null);
}
```

No changes to existing methods. No changes to server-side code.

---

## Test Changes (`lobby.spec.ts`)

New test cases to add:

| Scenario | Assertion |
|---|---|
| Non-host: kick button absent on all player cards | No `btn-danger` buttons rendered within `.player-card` elements |
| Host: kick button absent on own player card | No kick button on the "You" card |
| Host: kick button present on other player card | Kick button rendered for the non-self player |
| Click kick button | `playerToKick` signal set; modal appears with correct alias |
| Click Cancel in modal | Modal dismissed; no WS message sent |
| Click backdrop | Modal dismissed; no WS message sent |
| Click Confirm Kick | `socket.send` called with `KICK_PLAYER` intent and correct `playerId`; modal dismissed; `playerToKick()` is `null` |
| Host kicks player with null alias | Modal shows alias as `'Unknown'` |

---

## Out of Scope

- Feedback to the kicked player (server-side, already handled via an `ERROR` frame with code `'KICKED'` — the lobby component's existing `ERROR` handler displays it)
- Kick during an in-progress match (server rejects it; this UI only appears in the Lobby screen)
- Host kicking themselves (button is not shown for the host's own card)

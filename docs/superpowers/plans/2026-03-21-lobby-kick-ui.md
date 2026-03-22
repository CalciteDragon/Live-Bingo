# Lobby Kick UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a host-only Kick button to each non-self player card in the lobby, with a confirmation modal before sending the `KICK_PLAYER` WebSocket intent.

**Architecture:** All changes are self-contained inside `LobbyComponent`. A `playerToKick` signal drives the confirmation modal state. The component already has all helpers (`buildClientMessage`, `amHost()`, `playersWithLocalStatus()`) and all needed CSS classes exist globally (`.modal-backdrop`, `.modal`, `.btn-danger`).

**Tech Stack:** Angular 17+ (standalone component, signals, `@if`/`@for` control flow), Vitest + Angular TestBed.

---

## File Map

| File | Change |
|---|---|
| `apps/web/src/app/pages/lobby/lobby.ts` | Add `playerToKick` signal + 3 methods; add kick button and modal to template |
| `apps/web/src/app/pages/lobby/lobby.spec.ts` | Add 12 new test cases in a new `describe` block (6 logic + 6 DOM) |

No new files. No new CSS. No server changes.

---

## Background: Test Harness

The existing `setup()` helper in `lobby.spec.ts` initialises `playerIdSignal` to `'p1'` — the host (slot 1). The mock state has two players:
- `p1 / c1 / slot 1 / alias 'Host'` — the current user (host)
- `p2 / c2 / slot 2 / alias 'Guest'`

To test non-host scenarios, call `playerIdSignal.set('p2')` after setup.

DOM tests require `fixture.detectChanges()` before querying. The existing tests do not query the DOM — these will be the first.

---

### Task 1: Component logic — signal and methods (TDD)

**Files:**
- Modify: `apps/web/src/app/pages/lobby/lobby.spec.ts`
- Modify: `apps/web/src/app/pages/lobby/lobby.ts`

- [ ] **Step 1.1: Write the failing tests**

Add a new `describe` block at the bottom of `lobby.spec.ts`:

```ts
describe('LobbyComponent — kick player', () => {
  it('openKickConfirm sets playerToKick with resolved alias', () => {
    const state = makeState();
    const { comp } = setup(state);

    comp.openKickConfirm({ playerId: 'p2', alias: 'Guest' });

    expect(comp.playerToKick()).toEqual({ playerId: 'p2', alias: 'Guest' });
  });

  it('openKickConfirm resolves null alias to "Unknown"', () => {
    const state = makeState();
    const { comp } = setup(state);

    comp.openKickConfirm({ playerId: 'p2', alias: null });

    expect(comp.playerToKick()).toEqual({ playerId: 'p2', alias: 'Unknown' });
  });

  it('cancelKick clears playerToKick', () => {
    const state = makeState();
    const { comp } = setup(state);

    comp.openKickConfirm({ playerId: 'p2', alias: 'Guest' });
    comp.cancelKick();

    expect(comp.playerToKick()).toBeNull();
  });

  it('confirmKick sends KICK_PLAYER with correct playerId', () => {
    const state = makeState();
    const { comp, mockSend } = setup(state);

    comp.openKickConfirm({ playerId: 'p2', alias: 'Guest' });
    comp.confirmKick();

    expect(mockSend).toHaveBeenCalledOnce();
    const msg = mockSend.mock.calls[0]![0];
    expect(msg.type).toBe('KICK_PLAYER');
    expect(msg.payload.playerId).toBe('p2');
    expect(msg.matchId).toBe('match-1');
  });

  it('confirmKick clears playerToKick signal after sending', () => {
    const state = makeState();
    const { comp } = setup(state);

    comp.openKickConfirm({ playerId: 'p2', alias: 'Guest' });
    comp.confirmKick();

    expect(comp.playerToKick()).toBeNull();
  });

  it('confirmKick does nothing when playerToKick is null', () => {
    const state = makeState();
    const { comp, mockSend } = setup(state);

    comp.confirmKick();

    expect(mockSend).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 1.2: Run the tests — expect failures**

```bash
npm run test --workspace=apps/web
```

Expected: 6 failures in the new describe block (`openKickConfirm is not a function`, etc.).

- [ ] **Step 1.3: Add the signal and methods to `lobby.ts`**

After the existing `readonly isEditingCountdown = signal(false);` line (around line 163), add:

```ts
readonly playerToKick = signal<{ playerId: string; alias: string } | null>(null);
```

After the `copyInviteLink()` method (before the closing `}`), add:

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

- [ ] **Step 1.4: Run tests — expect all passing**

```bash
npm run test --workspace=apps/web
```

Expected: all tests pass, including the 6 new ones.

- [ ] **Step 1.5: Commit**

```bash
git add apps/web/src/app/pages/lobby/lobby.ts apps/web/src/app/pages/lobby/lobby.spec.ts
git commit -m "feat(web): add kick player signal and methods to LobbyComponent"
```

---

### Task 2: Template — kick button and confirmation modal (TDD)

**Files:**
- Modify: `apps/web/src/app/pages/lobby/lobby.spec.ts`
- Modify: `apps/web/src/app/pages/lobby/lobby.ts`

- [ ] **Step 2.1: Write the failing DOM tests**

Add these tests inside the existing `describe('LobbyComponent — kick player', ...)` block (append after the last `it` from Task 1):

```ts
it('host sees kick button on non-self player cards', () => {
  // playerIdSignal defaults to 'p1' (host) in setup()
  const state = makeState();
  const { fixture } = setup(state);
  fixture.detectChanges();

  // p2's card should have a kick button; p1's should not
  const playerCards = fixture.nativeElement.querySelectorAll('.player-card') as NodeListOf<Element>;
  // Find cards with a .btn-danger button inside them (the kick button)
  const cardsWithKick = Array.from(playerCards).filter(card => card.querySelector('.btn-danger'));
  expect(cardsWithKick).toHaveLength(1);
});

it('host does not see kick button on own player card', () => {
  const state = makeState();
  const { fixture, comp } = setup(state);
  fixture.detectChanges();

  // The host's card (p1) should have no kick button
  const playerCards = fixture.nativeElement.querySelectorAll('.player-card') as NodeListOf<Element>;
  const hostCard = Array.from(playerCards).find(card =>
    card.textContent?.includes('Host')
  );
  expect(hostCard?.querySelector('.btn-danger')).toBeNull();
});

it('non-host does not see any kick buttons', () => {
  const state = makeState();
  const { fixture, playerIdSignal } = setup(state);
  playerIdSignal.set('p2'); // switch to non-host
  fixture.detectChanges();

  const buttons = fixture.nativeElement.querySelectorAll('.player-card .btn-danger');
  expect(buttons).toHaveLength(0);
});

it('clicking kick button opens confirmation modal with correct alias', () => {
  const state = makeState();
  const { fixture } = setup(state);
  fixture.detectChanges();

  // Click the kick button (there is exactly one, on the guest's card)
  const kickBtn = fixture.nativeElement.querySelector('.player-card .btn-danger') as HTMLButtonElement;
  kickBtn.click();
  fixture.detectChanges();

  const modal = fixture.nativeElement.querySelector('.modal') as HTMLElement | null;
  expect(modal).not.toBeNull();
  expect(modal?.textContent).toContain('Guest');
});

it('clicking Cancel in modal closes it without sending', () => {
  const state = makeState();
  const { fixture, comp, mockSend } = setup(state);
  fixture.detectChanges();

  comp.openKickConfirm({ playerId: 'p2', alias: 'Guest' });
  fixture.detectChanges();

  const cancelBtn = fixture.nativeElement.querySelector('.btn-ghost') as HTMLButtonElement;
  cancelBtn.click();
  fixture.detectChanges();

  expect(fixture.nativeElement.querySelector('.modal')).toBeNull();
  expect(mockSend).not.toHaveBeenCalled();
});
```

it('clicking Confirm Kick button in modal sends KICK_PLAYER and closes modal', () => {
  const state = makeState();
  const { fixture, comp, mockSend } = setup(state);
  fixture.detectChanges();

  comp.openKickConfirm({ playerId: 'p2', alias: 'Guest' });
  fixture.detectChanges();

  // The modal has two .btn-danger buttons: the kick button in the player card and the confirm button in the modal.
  // Query specifically inside .modal to get the confirm button.
  const confirmBtn = fixture.nativeElement.querySelector('.modal .btn-danger') as HTMLButtonElement;
  confirmBtn.click();
  fixture.detectChanges();

  expect(mockSend).toHaveBeenCalledOnce();
  const msg = mockSend.mock.calls[0]![0];
  expect(msg.type).toBe('KICK_PLAYER');
  expect(msg.payload.playerId).toBe('p2');
  expect(fixture.nativeElement.querySelector('.modal')).toBeNull();
});

> **Note on "click backdrop" test:** The modal backdrop's `(click)` binding calls `cancelKick()`. The spec's "Click backdrop" scenario is covered by the `cancelKick clears playerToKick` test in Task 1, which validates the method directly. A DOM click test for the backdrop requires `triggerEventHandler` and is redundant — skip it.

- [ ] **Step 2.2: Run the tests — expect failures**

```bash
npm run test --workspace=apps/web
```

Expected: the 6 new DOM tests fail (elements not found in template).

- [ ] **Step 2.3: Add the kick button to the player card template**

In `lobby.ts`, inside the `@for (player of playersWithLocalStatus(); ...)` block, after the last `<span class="badge"` for connection status (around line 74), add the kick button inside the `.player-card` div:

```html
@if (amHost() && !player.isMe) {
  <button class="btn-danger"
    style="margin-left: auto; padding: 0.25rem 0.75rem; font-size: 0.8125rem"
    (click)="openKickConfirm(player)">
    Kick
  </button>
}
```

The full updated player card block should look like:

```html
@for (player of playersWithLocalStatus(); track player.playerId) {
  <div class="player-card">
    <span class="player-card__alias">{{ player.alias ?? 'Unknown' }}</span>
    @if (player.isMe) {
      <span class="badge badge--you">You</span>
    }
    <span class="badge"
      [class.badge--ready]="readyStates()[player.playerId]"
      [class.badge--not-ready]="!readyStates()[player.playerId]">
      {{ readyStates()[player.playerId] ? 'Ready' : 'Not Ready' }}
    </span>
    <span class="badge"
      [class.badge--connected]="player.connected"
      [class.badge--disconnected]="!player.connected">
      {{ player.connected ? 'Connected' : 'Disconnected' }}
    </span>
    @if (amHost() && !player.isMe) {
      <button class="btn-danger"
        style="margin-left: auto; padding: 0.25rem 0.75rem; font-size: 0.8125rem"
        (click)="openKickConfirm(player)">
        Kick
      </button>
    }
  </div>
}
```

- [ ] **Step 2.4: Add the confirmation modal to the template**

In `lobby.ts`, at the very bottom of the template string (after the closing `</div>` of `<div class="page">`), add:

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

- [ ] **Step 2.5: Run tests — expect all passing**

```bash
npm run test --workspace=apps/web
```

Expected: all existing + all 12 new tests pass.

- [ ] **Step 2.6: Commit**

```bash
git add apps/web/src/app/pages/lobby/lobby.ts apps/web/src/app/pages/lobby/lobby.spec.ts
git commit -m "feat(web): add host kick button and confirmation modal to lobby"
```

---

### Task 3: Update documentation

**Files:**
- Modify: `docs/todos.md` — remove any kick-UI todo entry if present; add none (feature is complete)
- Modify: `.claude/web-client.md` — update the lobby component section to document `playerToKick`, `openKickConfirm`, `confirmKick`, `cancelKick`

- [ ] **Step 3.1: Check for stale todos**

Open `docs/todos.md`. If there is an entry mentioning "kick UI", "kick button", or "KICK_PLAYER UI", remove it. If there is no such entry, no change needed.

- [ ] **Step 3.2: Update `.claude/web-client.md`**

Find the LobbyComponent section in `.claude/web-client.md`. In the signals list, add:

```
- `playerToKick` — `{ playerId, alias } | null`; non-null while a kick confirmation modal is open
```

In the methods list (or equivalent), add:

```
- `openKickConfirm(player)` — sets `playerToKick` to open the confirmation modal (host-only, non-self)
- `confirmKick()` — sends `KICK_PLAYER` intent and clears `playerToKick`
- `cancelKick()` — clears `playerToKick` without sending
```

- [ ] **Step 3.3: Commit docs**

```bash
git add docs/todos.md .claude/web-client.md
git commit -m "docs: update lobby component docs for kick player UI"
```

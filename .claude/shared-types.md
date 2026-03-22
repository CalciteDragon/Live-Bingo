# packages/shared — Types & Schemas

Package: `@bingo/shared` — re-exports everything from `src/index.ts`.

Source files: `src/match.ts`, `src/events.ts`, `src/errors.ts`, `src/rest.ts`

## Domain Types (src/match.ts)

```typescript
type MatchStatus = 'Lobby' | 'InProgress' | 'Completed' | 'Abandoned'
type TimerMode = 'stopwatch' | 'countdown'
type Slot = 1 | 2 | 3 | 4
type MatchMode = 'ffa'  // only mode currently
type WinReason = 'line' | 'majority' | 'timer_expiry' | 'draw'

interface Player {
  playerId: string
  clientId: string
  slot: Slot
  alias: string | null
  connected: boolean
}

interface Cell {
  index: number        // 0-24, row-major
  goal: string
  markedBy: string | null  // playerId or null
}

interface BingoCard {
  seed: number
  cells: Cell[]        // length 25
}

interface LobbySettings {
  timerMode: TimerMode
  countdownDurationMs: number | null
}

interface TimerState {
  mode: TimerMode
  startedAt: string | null   // ISO 8601, null until match starts
  stoppedAt: string | null   // ISO 8601, null until match completes (set by server for client freeze)
  countdownDurationMs: number | null
}

interface MatchResult {
  winnerId: string | null   // null on draw
  reason: WinReason
}

interface MatchState {
  matchId: string
  matchMode: MatchMode
  status: MatchStatus
  players: Player[]
  readyStates: Record<string, boolean>  // playerId → ready
  lobbySettings: LobbySettings
  card: BingoCard
  timer: TimerState
  result: MatchResult | null
}
```

## Client → Server Events (src/events.ts)

Zod-validated `ClientMessageSchema` (discriminated union on `type`):

| Type | Payload | Who |
|---|---|---|
| `SYNC_STATE` | `{}` | any |
| `SET_READY` | `{ ready: boolean }` | any |
| `SET_LOBBY_SETTINGS` | `{ timerMode, countdownDurationMs? }` | host |
| `START_MATCH` | `{}` | host |
| `MARK_CELL` | `{ cellIndex: 0-24 }` | any |
| `UNMARK_CELL` | `{ cellIndex: 0-24 }` | any |
| `RESHUFFLE_BOARD` | `{}` | host |
| `BACK_TO_LOBBY` | `{}` | host |
| `REMATCH` | `{}` | host |
| `KICK_PLAYER` | `{ playerId: string (uuid) }` | host |

All messages include: `matchId` (uuid), `clientId` (uuid), `eventId` (uuid)

Derived types: `ClientMessage`, `ClientIntentType`, `SetReadyPayload`, `MarkCellPayload`, `UnmarkCellPayload`, `KickPlayerPayload`

## Server → Client Messages (src/events.ts)

Plain TypeScript (no Zod — server-generated, trusted):

| Type | Payload |
|---|---|
| `STATE_SYNC` | `{ state: MatchState }` |
| `STATE_UPDATE` | `{ state: MatchState, lastAppliedEventId? }` |
| `ERROR` | `{ code: WsErrorCode, message, rejectedEventId? }` |
| `MATCH_STARTED` | `{}` |
| `MATCH_COMPLETED` | `{ reason: WinReason, winnerId: string \| null }` |
| `PRESENCE_UPDATE` | `{ players: Player[], readyStates }` |

All include: `matchId: string`

## Error Types (src/errors.ts)

```typescript
type RestErrorCode =
  | 'JOIN_CODE_EXPIRED' | 'JOIN_CODE_INVALID' | 'MATCH_NOT_FOUND'
  | 'MATCH_FULL' | 'MATCH_NOT_JOINABLE' | 'CLIENT_CONFLICT' | 'FORBIDDEN'

type WsErrorCode =
  | 'INVALID_EVENT' | 'NOT_AUTHORIZED' | 'INVALID_STATE'
  | 'DUPLICATE_EVENT' | 'SESSION_REPLACED' | 'KICKED'

interface RestErrorResponse { code: RestErrorCode; message: string }
interface WsErrorPayload { code: WsErrorCode; message: string; rejectedEventId?: string }
```

## REST Schemas (src/rest.ts)

Zod schemas (trust boundary):
- `ClientIdHeaderSchema` — validates `X-Client-Id` header (UUID string)
- `CreateMatchBodySchema` — `{ alias: string (1-32 chars) }`
- `JoinMatchBodySchema` — `{ alias: string (1-32 chars), joinCode?: string }`

Response types (plain TS):
- `CreateMatchResponse` — `{ matchId, joinCode, joinUrl, state }`
- `JoinMatchResponse` — `{ matchId, playerId, state }`
- `GetMatchResponse` — `{ matchId, playerId, state }`
- `ResolveJoinCodeResponse` — `{ matchId }`

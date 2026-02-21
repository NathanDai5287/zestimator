# Trade or Tighten — API Reference

Base URL: `http://localhost:5000/api`

## Authentication

Protected endpoints require an `X-Player-Token` header. Tokens are issued on game
creation (`POST /games`) and when joining (`POST /games/<id>/join`).

Host-only endpoints additionally require the token to belong to the player who
created the game.

---

## Endpoints

### POST /games
Create a new game. Scrapes a random house listing; the price is hidden until
settlement. The caller becomes the host.

**Auth:** none

**Request body** (JSON, optional)
```json
{ "name": "Alice" }
```
| Field | Type   | Default | Description      |
|-------|--------|---------|------------------|
| name  | string | "Host"  | Host player name |

**Response 201**
```json
{
  "gameId": "uuid",
  "playerId": "uuid",
  "token": "uuid"
}
```

**Errors**
| Status | Meaning                          |
|--------|----------------------------------|
| 502    | Scraper failed or house has no price |

---

### POST /games/:id/join
Join a game that is still in the lobby.

**Auth:** none

**Request body** (JSON, optional)
```json
{ "name": "Bob" }
```
| Field | Type   | Default  | Description       |
|-------|--------|----------|-------------------|
| name  | string | "Player" | Player name       |

**Response 201**
```json
{
  "playerId": "uuid",
  "token": "uuid"
}
```

**Errors**
| Status | Meaning               |
|--------|-----------------------|
| 409    | Game is not in lobby  |

**SocketIO event emitted:** `player_joined`
```json
{ "playerId": "uuid", "name": "Bob" }
```

---

### GET /games/:id
Get current game state. Price and true value are hidden until the game reaches
`settlement` status.

**Auth:** `X-Player-Token` (any player in this game)

**Response 200**
```json
{
  "id": "uuid",
  "status": "lobby | auction | trading | settlement",
  "house": { ...zillow fields, price omitted unless settled },
  "trueValue": null,
  "marketBid": null,
  "marketAsk": null,
  "players": [
    {
      "id": "uuid",
      "name": "Alice",
      "balance": 10000,
      "isMarketMaker": false,
      "isHost": true
    }
  ],
  "trades": [
    {
      "id": 1,
      "playerId": "uuid",
      "direction": "buy | sell",
      "price": 450000,
      "pnl": null
    }
  ]
}
```
`trueValue` and `pnl` on trades are `null` until settlement.

**Errors**
| Status | Meaning         |
|--------|-----------------|
| 401    | Missing/invalid token |
| 403    | Token belongs to a different game |
| 404    | Game not found  |

---

### POST /games/:id/start-auction
Transition the game from `lobby` → `auction`. Players can now submit bid/ask spreads.

**Auth:** `X-Player-Token` (host only)

**Response 200**
```json
{ "status": "auction" }
```

**Errors**
| Status | Meaning                      |
|--------|------------------------------|
| 401    | Missing/invalid token        |
| 403    | Not the host                 |
| 409    | Game is not in lobby         |

**SocketIO event emitted:** `auction_started`
```json
{ "gameId": "uuid" }
```

---

### POST /games/:id/bid
Submit or update your bid/ask spread during the auction phase. Calling this again
updates your existing bid (upsert).

**Auth:** `X-Player-Token` (any player in this game)

**Request body** (JSON, required)
```json
{ "bid": 440000, "ask": 460000 }
```
| Field | Type   | Description            |
|-------|--------|------------------------|
| bid   | number | Bid price (must be < ask) |
| ask   | number | Ask price (must be > bid) |

**Response 200**
```json
{ "spread": 20000 }
```

**Errors**
| Status | Meaning                        |
|--------|--------------------------------|
| 400    | Missing bid/ask or ask ≤ bid   |
| 409    | Game is not in auction phase   |

**SocketIO event emitted:** `new_bid`
```json
{ "playerName": "Bob", "spread": 20000 }
```
Raw prices are not broadcast — only the spread.

---

### POST /games/:id/finish-auction
End the auction. The player with the tightest spread becomes the market maker
(ties broken by earliest submission time). Transitions to `trading`.

**Auth:** `X-Player-Token` (host only)

**Response 200**
```json
{
  "marketMaker": "Bob",
  "bid": 440000,
  "ask": 460000
}
```

**Errors**
| Status | Meaning                      |
|--------|------------------------------|
| 403    | Not the host                 |
| 409    | Game is not in auction phase, or no bids submitted |

**SocketIO event emitted:** `market_maker_selected`
```json
{ "playerName": "Bob", "bid": 440000, "ask": 460000 }
```

---

### POST /games/:id/trade
Make one trade against the market maker's spread. Each non-market-maker player
may trade exactly once. Buying hits the ask; selling hits the bid.

**Auth:** `X-Player-Token` (any non-market-maker player)

**Request body** (JSON, required)
```json
{ "direction": "buy" }
```
| Field     | Type   | Values          |
|-----------|--------|-----------------|
| direction | string | `"buy"` or `"sell"` |

**Response 200**
```json
{ "direction": "buy", "price": 460000 }
```

**Errors**
| Status | Meaning                              |
|--------|--------------------------------------|
| 400    | Invalid direction                    |
| 403    | Market maker cannot trade            |
| 409    | Not in trading phase, or already traded |

**SocketIO event emitted:** `new_trade`
```json
{ "playerName": "Alice", "direction": "buy", "price": 460000 }
```

---

### POST /games/:id/settle
Reveal the true value, calculate P&L for all players, update balances, and
transition to `settlement`. This is final — the game cannot be restarted.

**Auth:** `X-Player-Token` (host only)

**P&L rules:**
- Buyer: `true_value − ask_price`
- Seller: `bid_price − true_value`
- Market maker: sum of `−(each trader's P&L)` (zero-sum)

**Response 200** — full game state (same shape as `GET /games/:id`) with
`trueValue` and all `pnl` fields populated.

**Errors**
| Status | Meaning                      |
|--------|------------------------------|
| 403    | Not the host                 |
| 409    | Game is not in trading phase |

**SocketIO event emitted:** `settled` — full game state payload (same as response body).

---

## SocketIO Events

Connect to the server with a standard Socket.IO client. After connecting, emit
`join_game` with your token to subscribe to real-time updates for your game.

### Client → Server

#### join_game
```json
{ "token": "your-player-token" }
```
Validates the token and joins the socket room for that game. All subsequent
server-emitted events for the game will be received on this connection.

### Server → Client

| Event                  | Emitted by            | Payload                                      |
|------------------------|-----------------------|----------------------------------------------|
| `player_joined`        | POST /join            | `{ playerId, name }`                         |
| `auction_started`      | POST /start-auction   | `{ gameId }`                                 |
| `new_bid`              | POST /bid             | `{ playerName, spread }`                     |
| `market_maker_selected`| POST /finish-auction  | `{ playerName, bid, ask }`                   |
| `new_trade`            | POST /trade           | `{ playerName, direction, price }`           |
| `settled`              | POST /settle          | full game state (see GET /games/:id response)|

---

## Game Status Flow

```
lobby → auction → trading → settlement
         ↑
    start-auction (host)
                  ↑
            finish-auction (host)
                           ↑
                        settle (host)
```

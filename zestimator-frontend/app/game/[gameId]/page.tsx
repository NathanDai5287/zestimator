'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

const API = '/api';
const WS_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:5001';

interface House {
  address: string;
  addressStreet?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  squareFootage?: number | null;
  lotSize?: number | null;
  lotSizeUnit?: string | null;
  yearBuilt?: number | null;
  daysOnZillow?: number | null;
  propertyType?: string | null;
  statusText?: string | null;
  taxAssessedValue?: number | null;
  photos?: string[];
  price?: number | null;
  streetViewUrl?: string | null;
  url?: string | null;
}

interface Player {
  id: string;
  name: string;
  balance: number;
  isMarketMaker: boolean;
  isHost: boolean;
}

interface Trade {
  id: number;
  playerId: string;
  direction: 'buy' | 'sell';
  price: number;
  pnl: number | null;
}

interface GameState {
  id: string;
  status: 'lobby' | 'auction' | 'quoting' | 'trading' | 'settlement';
  house: House;
  trueValue: number | null;
  agreedSpread: number | null;
  marketBid: number | null;
  marketAsk: number | null;
  auctionDeadline?: number | null;
  quotingDeadline?: number | null;
  tradingDeadline?: number | null;
  players: Player[];
  trades: Trade[];
}

type ApiCall = (
  path: string,
  body?: Record<string, unknown>
) => Promise<{ ok: boolean; data: unknown }>;

function fmt(n: number) {
  const r = Math.round(n);
  return r < 0 ? '-$' + Math.abs(r).toLocaleString() : '$' + r.toLocaleString();
}

function pnlFmt(n: number) {
  return (n >= 0 ? '+$' : '-$') + Math.round(Math.abs(n)).toLocaleString();
}

function playerName(game: GameState, playerId: string) {
  return game.players.find(p => p.id === playerId)?.name ?? 'Unknown';
}

function buildStreetViewEmbedUrl(streetViewUrl?: string | null): string | null {
  if (!streetViewUrl) return null;
  try {
    const parsed = new URL(streetViewUrl);
    const viewpoint = parsed.searchParams.get('viewpoint');
    if (!viewpoint) {
      return `${streetViewUrl}${streetViewUrl.includes('?') ? '&' : '?'}output=embed`;
    }
    return `https://www.google.com/maps?q=&layer=c&cbll=${encodeURIComponent(
      viewpoint
    )}&cbp=11,0,0,0,0&output=svembed`;
  } catch {
    return null;
  }
}

export default function GamePage() {
  const params = useParams<{ gameId: string }>();
  const gameId = params.gameId;

  const [game, setGame] = useState<GameState | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [apiError, setApiError] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());

  const socketRef = useRef<ReturnType<typeof import('socket.io-client')['io']> | null>(null);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    const t = localStorage.getItem(`token:${gameId}`);
    const pid = localStorage.getItem(`playerId:${gameId}`);
    setToken(t);
    setMyPlayerId(pid);
    tokenRef.current = t;
  }, [gameId]);

  const refresh = useCallback(async () => {
    const t = tokenRef.current;
    if (!t) return;
    try {
      const res = await fetch(`${API}/games/${gameId}`, {
        headers: { 'X-Player-Token': t },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data: GameState = await res.json();
      setGame(data);
    } catch {
      // no-op, polling fallback retries
    }
  }, [gameId]);

  useEffect(() => {
    if (!token) return;
    tokenRef.current = token;
    refresh();

    import('socket.io-client').then(({ io }) => {
      const socket = io(WS_URL);
      socketRef.current = socket;

      socket.on('connect', () => socket.emit('join_game', { token }));
      socket.on('player_joined', refresh);
      socket.on('auction_started', refresh);
      socket.on('new_bid', refresh);
      socket.on('market_maker_selected', refresh);
      socket.on('quotes_set', refresh);
      socket.on('new_trade', refresh);
      socket.on('settled', (state: GameState) => setGame(state));
      socket.on('new_round', refresh);
    });

    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [token, gameId, refresh]);

  useEffect(() => {
    if (!token || !game) return;
    if (game.status === 'settlement') return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [token, game, refresh]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  if (!token || !myPlayerId) {
    return (
      <main className="page-shell">
        <section className="panel">
          <p className="error">No session found for this room. <Link href="/">Go home</Link>.</p>
        </section>
      </main>
    );
  }

  if (!game) {
    return (
      <main className="page-shell">
        <section className="panel">
          <p className="muted">Loading game state...</p>
        </section>
      </main>
    );
  }

  const me = game.players.find(p => p.id === myPlayerId);
  const isHost = me?.isHost ?? false;
  const isMarketMaker = me?.isMarketMaker ?? false;
  const activeDeadline =
    game.status === 'auction'
      ? game.auctionDeadline ?? null
      : game.status === 'quoting'
        ? game.quotingDeadline ?? null
        : game.status === 'trading'
          ? game.tradingDeadline ?? null
          : null;
  const phaseSecondsLeft =
    activeDeadline != null ? Math.max(0, Math.ceil((activeDeadline - nowMs) / 1000)) : null;

  async function apiCall(path: string, body?: Record<string, unknown>) {
    setApiError('');
    try {
      const res = await fetch(`${API}/games/${gameId}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Player-Token': token!,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        setApiError((data as { error?: string }).error ?? 'Error');
      } else {
        refresh();
      }
      return { ok: res.ok, data };
    } catch {
      setApiError('Network error');
      return { ok: false, data: null };
    }
  }

  return (
    <main className="page-shell">
      <section className="panel">
        <p className="kicker">Trade or Tighten</p>
        <h1 className="title" style={{ marginTop: 8 }}>Game Room {gameId}</h1>
        <div className="row" style={{ marginTop: 10 }}>
          <span className="status-chip">Phase: {game.status}</span>
          {me && (
            <span className="status-chip status-chip-role">
              {me.name} · {isMarketMaker ? 'Market Maker' : isHost ? 'Host' : 'Player'}
            </span>
          )}
          {me && (
            <span className="status-chip status-chip-pl">
              P/L {fmt(me.balance)}
            </span>
          )}
          {phaseSecondsLeft != null && (
            <span className="status-chip status-chip-time">
              Time Left: {phaseSecondsLeft}s
            </span>
          )}
        </div>
      </section>

      {apiError && <p className="error" style={{ marginTop: 14 }}>{apiError}</p>}

      <div className="data-grid" style={{ marginTop: 14 }}>
        <div>
          <HouseInfo house={game.house} />

          {game.status === 'lobby' && (
            <LobbyPanel gameId={gameId} isHost={isHost} apiCall={apiCall} />
          )}
          {game.status === 'auction' && (
            <AuctionPanel isHost={isHost} apiCall={apiCall} phaseSecondsLeft={phaseSecondsLeft} />
          )}
          {game.status === 'quoting' && (
            <QuotingPanel game={game} isMarketMaker={isMarketMaker} apiCall={apiCall} phaseSecondsLeft={phaseSecondsLeft} />
          )}
          {game.status === 'trading' && (
            <TradingPanel
              game={game}
              myPlayerId={myPlayerId}
              isMarketMaker={isMarketMaker}
              apiCall={apiCall}
              phaseSecondsLeft={phaseSecondsLeft}
            />
          )}
          {game.status === 'settlement' && (
            <SettlementPanel game={game} myPlayerId={myPlayerId} isHost={isHost} apiCall={apiCall} />
          )}
        </div>

        <PlayerList game={game} myPlayerId={myPlayerId} />
      </div>
    </main>
  );
}

function HouseInfo({ house }: { house: House }) {
  const photos = house.photos ?? [];
  const streetViewEmbed = buildStreetViewEmbedUrl(house.streetViewUrl);
  return (
    <section className="panel">
      <p className="kicker">Property</p>
      <h3 className="title" style={{ marginTop: 8, fontSize: 24 }}>{house.address}</h3>
      <p className="subtitle">
        {[
          house.propertyType,
          house.statusText,
          house.bedrooms != null ? `${house.bedrooms} bed` : null,
          house.bathrooms != null ? `${house.bathrooms} bath` : null,
          house.squareFootage != null ? `${house.squareFootage.toLocaleString()} sqft` : null,
          house.lotSize != null ? `lot ${house.lotSize.toLocaleString()} ${house.lotSizeUnit ?? ''}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p className="subtitle">
        {[
          house.yearBuilt != null ? `Built ${house.yearBuilt}` : null,
          house.daysOnZillow != null ? `${house.daysOnZillow} days on Zillow` : null,
          house.taxAssessedValue != null ? `Tax assessed ${fmt(house.taxAssessedValue)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {house.price != null && (
        <p style={{ marginTop: 8 }}>
          List price: <span className="value">{fmt(house.price)}</span>
        </p>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        {house.url && (
          <a className="btn btn-secondary" href={house.url} target="_blank" rel="noreferrer">
            View on Zillow
          </a>
        )}
        {house.streetViewUrl && (
          <a className="btn btn-secondary" href={house.streetViewUrl} target="_blank" rel="noreferrer">
            Open Street View
          </a>
        )}
      </div>

      {streetViewEmbed && (
        <div style={{ marginTop: 12 }}>
          <p className="kicker">Street View Preview</p>
          <iframe
            title="Street View"
            src={streetViewEmbed}
            className="streetview-frame"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      )}

      {photos.length > 0 && (
        <div className="photo-strip">
          {photos.map((url, i) => (
            <img key={i} src={url} alt={`property photo ${i + 1}`} />
          ))}
        </div>
      )}
    </section>
  );
}

function PlayerList({ game, myPlayerId }: { game: GameState; myPlayerId: string }) {
  return (
    <section className="panel">
      <p className="kicker">Leaderboard</p>
      <h3 className="title" style={{ marginTop: 8, fontSize: 22 }}>Players</h3>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th style={{ textAlign: 'right' }}>P/L</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {game.players.map(p => (
              <tr key={p.id} style={{ fontWeight: p.id === myPlayerId ? 700 : 500 }}>
                <td>{p.name}</td>
                <td style={{ textAlign: 'right', color: p.balance >= 0 ? 'var(--positive)' : 'var(--danger)' }}>
                  {fmt(p.balance)}
                </td>
                <td>{[p.isHost ? 'Host' : null, p.isMarketMaker ? 'Market Maker' : null].filter(Boolean).join(', ') || 'Player'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LobbyPanel({
  gameId,
  isHost,
  apiCall,
}: {
  gameId: string;
  isHost: boolean;
  apiCall: ApiCall;
}) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function startAuction() {
    setLoading(true);
    await apiCall('/start-auction');
    setLoading(false);
  }

  function copyRoomId() {
    navigator.clipboard.writeText(gameId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="panel">
      <p className="kicker">Lobby</p>
      <h3 className="title" style={{ marginTop: 8, fontSize: 22 }}>Waiting for Players</h3>
      <p className="subtitle" style={{ marginTop: 8 }}>
        Share room ID <code style={{ color: 'var(--accent)' }}>{gameId}</code> and wait until everyone joins.
      </p>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn btn-secondary" onClick={copyRoomId}>{copied ? 'Copied' : 'Copy Room ID'}</button>
        {isHost && (
          <button className="btn" onClick={startAuction} disabled={loading}>
            Start Auction
          </button>
        )}
      </div>
    </section>
  );
}

function AuctionPanel({
  isHost,
  apiCall,
  phaseSecondsLeft,
}: {
  isHost: boolean;
  apiCall: ApiCall;
  phaseSecondsLeft: number | null;
}) {
  const [spreadVal, setSpreadVal] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const spreadNum = parseFloat(spreadVal);
  const valid = !isNaN(spreadNum) && spreadNum > 0;

  async function submitBid() {
    if (!valid) return;
    setLoading(true);
    const result = await apiCall('/bid', { spread: spreadNum });
    if (result.ok) setSubmitted(true);
    setLoading(false);
  }

  async function finishAuction() {
    setLoading(true);
    await apiCall('/finish-auction');
    setLoading(false);
  }

  return (
    <section className="panel">
      <p className="kicker">Phase 1</p>
      <h3 className="title" style={{ marginTop: 8, fontSize: 22 }}>Auction</h3>
      <p className="subtitle">
        Submit your spread. Bids are hidden until auction ends.
        {phaseSecondsLeft != null ? ` ${phaseSecondsLeft}s remaining.` : ''}
      </p>

      <div className="row" style={{ marginTop: 10, alignItems: 'end' }}>
        <div style={{ minWidth: 170 }}>
          <label htmlFor="spread-input">Your spread</label>
          <input
            id="spread-input"
            type="number"
            value={spreadVal}
            onChange={e => setSpreadVal(e.target.value)}
            placeholder="e.g. 20000"
            onKeyDown={e => e.key === 'Enter' && submitBid()}
          />
        </div>
        <button className="btn" onClick={submitBid} disabled={loading || !valid}>Submit</button>
        {isHost && (
          <button className="btn btn-secondary" onClick={finishAuction} disabled={loading}>
            End Auction
          </button>
        )}
      </div>
      {submitted && <p className="subtitle" style={{ marginTop: 10 }}>Your spread is locked in.</p>}
    </section>
  );
}

function QuotingPanel({
  game,
  isMarketMaker,
  apiCall,
  phaseSecondsLeft,
}: {
  game: GameState;
  isMarketMaker: boolean;
  apiCall: ApiCall;
  phaseSecondsLeft: number | null;
}) {
  const [centerVal, setCenterVal] = useState('');
  const [loading, setLoading] = useState(false);

  const agreedSpread = game.agreedSpread;
  const centerNum = parseFloat(centerVal);
  const half = agreedSpread != null ? agreedSpread / 2 : null;
  const bidNum = half != null && !isNaN(centerNum) ? centerNum - half : null;
  const askNum = half != null && !isNaN(centerNum) ? centerNum + half : null;
  const ready = bidNum != null && askNum != null;

  const mm = game.players.find(p => p.isMarketMaker);

  async function setQuotes() {
    if (!ready) return;
    setLoading(true);
    await apiCall('/set-quotes', { bid: bidNum, ask: askNum });
    setLoading(false);
  }

  return (
    <section className="panel">
      <p className="kicker">Phase 2</p>
      <h3 className="title" style={{ marginTop: 8, fontSize: 22 }}>Set Quotes</h3>
      <p className="subtitle">
        Market maker: <span className="value">{mm?.name}</span> · Spread: <span className="value">{agreedSpread != null ? fmt(agreedSpread) : '?'}</span>
        {phaseSecondsLeft != null ? ` · ${phaseSecondsLeft}s remaining` : ''}
      </p>

      {isMarketMaker ? (
        <div className="row" style={{ marginTop: 12, alignItems: 'end' }}>
          <div style={{ minWidth: 170 }}>
            <label htmlFor="mid-input">Mid Price</label>
            <input
              id="mid-input"
              type="number"
              value={centerVal}
              onChange={e => setCenterVal(e.target.value)}
              placeholder="e.g. 350000"
              onKeyDown={e => e.key === 'Enter' && setQuotes()}
            />
          </div>
          <div>
            <p className="muted" style={{ margin: 0 }}>Bid</p>
            <p className="value" style={{ margin: 0 }}>{ready ? fmt(bidNum!) : '—'}</p>
          </div>
          <div>
            <p className="muted" style={{ margin: 0 }}>Ask</p>
            <p className="value" style={{ margin: 0 }}>{ready ? fmt(askNum!) : '—'}</p>
          </div>
          <button className="btn" onClick={setQuotes} disabled={loading || !ready}>Set Market</button>
        </div>
      ) : (
        <p className="subtitle" style={{ marginTop: 10 }}>
          Waiting for {mm?.name} to set bid and ask.
        </p>
      )}
    </section>
  );
}

function TradingPanel({
  game,
  myPlayerId,
  isMarketMaker,
  apiCall,
  phaseSecondsLeft,
}: {
  game: GameState;
  myPlayerId: string;
  isMarketMaker: boolean;
  apiCall: ApiCall;
  phaseSecondsLeft: number | null;
}) {
  const [loading, setLoading] = useState(false);

  const myTrade = game.trades.find(t => t.playerId === myPlayerId);
  const mm = game.players.find(p => p.isMarketMaker);

  async function trade(direction: 'buy' | 'sell') {
    setLoading(true);
    await apiCall('/trade', { direction });
    setLoading(false);
  }

  return (
    <section className="panel">
      <p className="kicker">Phase 3</p>
      <h3 className="title" style={{ marginTop: 8, fontSize: 22 }}>Trading</h3>
      <p className="subtitle">
        Market maker: <span className="value">{mm?.name ?? '?'}</span> · Bid <span className="value">{game.marketBid != null ? fmt(game.marketBid) : '?'}</span> · Ask <span className="value">{game.marketAsk != null ? fmt(game.marketAsk) : '?'}</span>
        {phaseSecondsLeft != null ? ` · ${phaseSecondsLeft}s remaining` : ''}
      </p>

      {isMarketMaker ? (
        <p className="subtitle" style={{ marginTop: 10 }}>You are market maker. You automatically take the opposite side of each trade.</p>
      ) : myTrade ? (
        <p style={{ marginTop: 10 }}>
          Submitted: <span className="value">{myTrade.direction.toUpperCase()}</span> at <span className="value">{fmt(myTrade.price)}</span>
        </p>
      ) : (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => trade('buy')} disabled={loading}>
            Buy @ {game.marketAsk != null ? fmt(game.marketAsk) : '?'}
          </button>
          <button className="btn btn-secondary" onClick={() => trade('sell')} disabled={loading}>
            Sell @ {game.marketBid != null ? fmt(game.marketBid) : '?'}
          </button>
        </div>
      )}

      <p className="subtitle" style={{ marginTop: 10 }}>
        Trade actions are hidden until settlement.
      </p>
    </section>
  );
}

function SettlementPanel({
  game,
  myPlayerId,
  isHost,
  apiCall,
}: {
  game: GameState;
  myPlayerId: string;
  isHost: boolean;
  apiCall: ApiCall;
}) {
  const [loading, setLoading] = useState(false);
  const mm = game.players.find(p => p.isMarketMaker);

  async function startNewRound() {
    setLoading(true);
    await apiCall('/new-round');
    setLoading(false);
  }

  return (
    <section className="panel">
      <p className="kicker">Phase 4</p>
      <h3 className="title" style={{ marginTop: 8, fontSize: 22 }}>Settlement</h3>
      <p className="subtitle">
        True value: <span className="value">{game.trueValue != null ? fmt(game.trueValue) : '?'}</span>
      </p>
      {game.marketBid != null && game.marketAsk != null && (
        <p className="subtitle">
          {mm?.name} quoted {fmt(game.marketBid)} / {fmt(game.marketAsk)}
        </p>
      )}

      <h4 className="title" style={{ fontSize: 18, marginTop: 12 }}>Trades &amp; P/L</h4>
      {game.trades.length === 0 ? (
        <p className="subtitle">No trades were made.</p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Direction</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th style={{ textAlign: 'right' }}>P/L</th>
              </tr>
            </thead>
            <tbody>
              {game.trades.map(t => (
                <tr key={t.id} style={{ fontWeight: t.playerId === myPlayerId ? 700 : 500 }}>
                  <td>{playerName(game, t.playerId)}</td>
                  <td>{t.direction}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(t.price)}</td>
                  <td
                    style={{
                      textAlign: 'right',
                      color: t.pnl != null ? (t.pnl >= 0 ? 'var(--positive)' : 'var(--danger)') : 'var(--text)',
                    }}
                  >
                    {t.pnl != null ? pnlFmt(t.pnl) : '?'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4 className="title" style={{ fontSize: 18, marginTop: 12 }}>Total P/L</h4>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {game.players.map(p => (
              <tr key={p.id} style={{ fontWeight: p.id === myPlayerId ? 700 : 500 }}>
                <td>{p.name}{p.isMarketMaker ? ' (MM)' : ''}</td>
                <td style={{ textAlign: 'right', color: p.balance >= 0 ? 'var(--positive)' : 'var(--danger)' }}>
                  {pnlFmt(p.balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        {isHost && (
          <button className="btn" onClick={startNewRound} disabled={loading}>
            Next Round
          </button>
        )}
        <Link className="btn btn-secondary" href="/">Leave Game</Link>
      </div>
    </section>
  );
}

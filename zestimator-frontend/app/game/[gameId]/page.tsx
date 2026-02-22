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
        <p className="kicker">zestimator · room {gameId}</p>
        <div className="row" style={{ marginTop: 10 }}>
          <span className="status-chip">{game.status}</span>
          {me && (
            <span className="status-chip status-chip-role">
              {me.name} · {isMarketMaker ? 'market maker' : isHost ? 'host' : 'player'}
            </span>
          )}
          {me && (
            <span className="status-chip status-chip-pl">
              p/l {fmt(me.balance)}
            </span>
          )}
          {phaseSecondsLeft != null && (
            <span className="status-chip status-chip-time">
              {phaseSecondsLeft}s left
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
      <p className="kicker">property</p>
      <h3 className="title" style={{ marginTop: 6 }}>{house.address}</h3>
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
        <p className="subtitle" style={{ marginTop: 8 }}>
          list price: <span className="value">{fmt(house.price)}</span>
        </p>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        {house.url && (
          <a className="btn btn-secondary" href={house.url} target="_blank" rel="noreferrer">
            zillow
          </a>
        )}
        {house.streetViewUrl && (
          <a className="btn btn-secondary" href={house.streetViewUrl} target="_blank" rel="noreferrer">
            street view
          </a>
        )}
      </div>

      {streetViewEmbed && (
        <div style={{ marginTop: 12 }}>
          <p className="kicker">street view</p>
          <iframe
            title="Street View"
            src={streetViewEmbed}
            className="streetview-frame"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      )}

      {photos.length > 0 && <PhotoCarousel photos={photos} />}
    </section>
  );
}

function PhotoCarousel({ photos }: { photos: string[] }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);

  function updateButtons() {
    const el = stripRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }

  function scroll(dir: -1 | 1) {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.75, behavior: 'smooth' });
  }

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    updateButtons();
    const ro = new ResizeObserver(updateButtons);
    ro.observe(el);
    return () => ro.disconnect();
  }, [photos.length]);

  return (
    <div className="carousel">
      <div className="carousel-track" ref={stripRef} onScroll={updateButtons}>
        {photos.map((url, i) => (
          <img key={i} src={url} alt={`property photo ${i + 1}`} />
        ))}
      </div>
      {photos.length > 1 && (
        <>
          <button
            className="carousel-btn carousel-btn-left"
            onClick={() => scroll(-1)}
            disabled={!canLeft}
            aria-label="Previous photos"
          >
            ‹
          </button>
          <button
            className="carousel-btn carousel-btn-right"
            onClick={() => scroll(1)}
            disabled={!canRight}
            aria-label="Next photos"
          >
            ›
          </button>
        </>
      )}
    </div>
  );
}

function PlayerList({ game, myPlayerId }: { game: GameState; myPlayerId: string }) {
  return (
    <section className="panel">
      <p className="kicker">leaderboard</p>
      <h3 className="title" style={{ marginTop: 6, fontSize: 18 }}>players</h3>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table>
          <thead>
            <tr>
              <th>name</th>
              <th style={{ textAlign: 'right' }}>p/l</th>
              <th>role</th>
            </tr>
          </thead>
          <tbody>
            {game.players.map(p => (
              <tr key={p.id} style={{ fontWeight: p.id === myPlayerId ? 700 : 500 }}>
                <td>{p.name}</td>
                <td style={{ textAlign: 'right', color: p.balance >= 0 ? 'var(--positive)' : 'var(--danger)' }}>
                  {fmt(p.balance)}
                </td>
                <td>{[p.isHost ? 'host' : null, p.isMarketMaker ? 'market maker' : null].filter(Boolean).join(', ') || 'player'}</td>
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
      <p className="kicker">lobby</p>
      <h3 className="title" style={{ marginTop: 6, fontSize: 18 }}>waiting for players</h3>
      <p className="subtitle" style={{ marginTop: 8 }}>
        share room id <code style={{ fontWeight: 600 }}>{gameId}</code> and wait for everyone to join.
      </p>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn btn-secondary" onClick={copyRoomId}>{copied ? 'copied' : 'copy room id'}</button>
        {isHost && (
          <button className="btn" onClick={startAuction} disabled={loading}>
            start auction
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
      <p className="kicker">phase 1 · auction</p>
      <p className="subtitle" style={{ marginTop: 6 }}>
        submit your spread. bids are hidden until auction ends.
        {phaseSecondsLeft != null ? ` ${phaseSecondsLeft}s remaining.` : ''}
      </p>

      <div className="row" style={{ marginTop: 10, alignItems: 'end' }}>
        <div style={{ minWidth: 170 }}>
          <label htmlFor="spread-input">your spread</label>
          <input
            id="spread-input"
            type="number"
            value={spreadVal}
            onChange={e => setSpreadVal(e.target.value)}
            placeholder="e.g. 20000"
            onKeyDown={e => e.key === 'Enter' && submitBid()}
          />
        </div>
        <button className="btn" onClick={submitBid} disabled={loading || !valid}>submit</button>
        {isHost && (
          <button className="btn btn-secondary" onClick={finishAuction} disabled={loading}>
            end auction
          </button>
        )}
      </div>
      {submitted && <p className="subtitle" style={{ marginTop: 10 }}>spread locked in.</p>}
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
      <p className="kicker">phase 2 · set quotes</p>
      <p className="subtitle" style={{ marginTop: 6 }}>
        market maker: <span className="value">{mm?.name}</span> · spread: <span className="value">{agreedSpread != null ? fmt(agreedSpread) : '?'}</span>
        {phaseSecondsLeft != null ? ` · ${phaseSecondsLeft}s remaining` : ''}
      </p>

      {isMarketMaker ? (
        <div className="row" style={{ marginTop: 12, alignItems: 'end' }}>
          <div style={{ minWidth: 170 }}>
            <label htmlFor="mid-input">mid price</label>
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
            <p className="muted" style={{ margin: 0, fontSize: 11 }}>bid</p>
            <p className="value" style={{ margin: 0 }}>{ready ? fmt(bidNum!) : '—'}</p>
          </div>
          <div>
            <p className="muted" style={{ margin: 0, fontSize: 11 }}>ask</p>
            <p className="value" style={{ margin: 0 }}>{ready ? fmt(askNum!) : '—'}</p>
          </div>
          <button className="btn" onClick={setQuotes} disabled={loading || !ready}>set market</button>
        </div>
      ) : (
        <p className="subtitle" style={{ marginTop: 10 }}>
          waiting for {mm?.name} to set bid and ask.
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
      <p className="kicker">phase 3 · trading</p>
      <p className="subtitle" style={{ marginTop: 6 }}>
        market maker: <span className="value">{mm?.name ?? '?'}</span> · bid <span className="value">{game.marketBid != null ? fmt(game.marketBid) : '?'}</span> · ask <span className="value">{game.marketAsk != null ? fmt(game.marketAsk) : '?'}</span>
        {phaseSecondsLeft != null ? ` · ${phaseSecondsLeft}s remaining` : ''}
      </p>

      {isMarketMaker ? (
        <p className="subtitle" style={{ marginTop: 10 }}>you are market maker. you take the opposite side of each trade.</p>
      ) : myTrade ? (
        <p className="subtitle" style={{ marginTop: 10 }}>
          submitted: <span className="value">{myTrade.direction}</span> at <span className="value">{fmt(myTrade.price)}</span>
        </p>
      ) : (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => trade('buy')} disabled={loading}>
            buy @ {game.marketAsk != null ? fmt(game.marketAsk) : '?'}
          </button>
          <button className="btn btn-secondary" onClick={() => trade('sell')} disabled={loading}>
            sell @ {game.marketBid != null ? fmt(game.marketBid) : '?'}
          </button>
        </div>
      )}

      <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
        trades are hidden until settlement.
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
      <p className="kicker">phase 4 · settlement</p>
      <p className="subtitle" style={{ marginTop: 6 }}>
        true value: <span className="value">{game.trueValue != null ? fmt(game.trueValue) : '?'}</span>
      </p>
      {game.marketBid != null && game.marketAsk != null && (
        <p className="subtitle">
          {mm?.name} quoted {fmt(game.marketBid)} / {fmt(game.marketAsk)}
        </p>
      )}

      <p className="kicker" style={{ marginTop: 14 }}>trades &amp; p/l</p>
      {game.trades.length === 0 ? (
        <p className="subtitle">no trades were made.</p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr>
                <th>player</th>
                <th>direction</th>
                <th style={{ textAlign: 'right' }}>price</th>
                <th style={{ textAlign: 'right' }}>p/l</th>
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

      <p className="kicker" style={{ marginTop: 14 }}>total p/l</p>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table>
          <thead>
            <tr>
              <th>player</th>
              <th style={{ textAlign: 'right' }}>total</th>
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

      <div className="row" style={{ marginTop: 14 }}>
        {isHost && (
          <button className="btn" onClick={startNewRound} disabled={loading}>
            next round
          </button>
        )}
        <Link className="btn btn-secondary" href="/">leave game</Link>
      </div>
    </section>
  );
}

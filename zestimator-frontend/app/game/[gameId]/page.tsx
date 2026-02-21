'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

const API = '/api';
const WS_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:5001';

// --- Types ---

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
  players: Player[];
  trades: Trade[];
}

interface BidRecord {
  playerName: string;
  spread: number;
}

type ApiCall = (
  path: string,
  body?: Record<string, unknown>
) => Promise<{ ok: boolean; data: unknown }>;

// --- Helpers ---

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

// --- Main Component ---

export default function GamePage() {
  const params = useParams<{ gameId: string }>();
  const gameId = params.gameId;

  const [game, setGame] = useState<GameState | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [bids, setBids] = useState<BidRecord[]>([]);
  const [apiError, setApiError] = useState('');
  const socketRef = useRef<ReturnType<typeof import('socket.io-client')['io']> | null>(null);
  const tokenRef = useRef<string | null>(null);

  // Load credentials from localStorage
  useEffect(() => {
    const t = localStorage.getItem(`token:${gameId}`);
    const pid = localStorage.getItem(`playerId:${gameId}`);
    setToken(t);
    setMyPlayerId(pid);
    tokenRef.current = t;
  }, [gameId]);

  // Stable refresh — uses ref so it can be called from anywhere without stale closures
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
    } catch { /* ignore */ }
  }, [gameId]);

  // Connect socket
  useEffect(() => {
    if (!token) return;
    tokenRef.current = token;

    refresh();

    import('socket.io-client').then(({ io }) => {
      const socket = io(WS_URL);
      socketRef.current = socket;

      socket.on('connect', () => socket.emit('join_game', { token }));

      socket.on('player_joined', refresh);
      socket.on('auction_started', () => { setBids([]); refresh(); });
      socket.on('new_bid', (d: BidRecord) => {
        setBids(prev => [...prev.filter(b => b.playerName !== d.playerName), d]);
        refresh();
      });
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

  // Polling fallback — catches any missed socket events
  useEffect(() => {
    if (!token || !game) return;
    if (game.status === 'settlement') return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [token, game?.status, refresh]);

  if (!token || !myPlayerId) {
    return (
      <div style={{ padding: 24, fontFamily: 'monospace' }}>
        No session found for this room. <a href="/">Go home</a>
      </div>
    );
  }

  if (!game) {
    return <div style={{ padding: 24, fontFamily: 'monospace' }}>Loading game...</div>;
  }

  const me = game.players.find(p => p.id === myPlayerId);
  const isHost = me?.isHost ?? false;
  const isMarketMaker = me?.isMarketMaker ?? false;

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
        // Always refresh after a successful action in case the socket event is missed
        refresh();
      }
      return { ok: res.ok, data };
    } catch {
      setApiError('Network error');
      return { ok: false, data: null };
    }
  }

  return (
    <div style={{ padding: 16, maxWidth: 860, fontFamily: 'monospace' }}>
      <h2 style={{ marginBottom: 4 }}>Zestimator</h2>
      <p style={{ margin: '4px 0' }}>
        Room: <code>{gameId}</code>
      </p>
      <p style={{ margin: '4px 0' }}>
        Phase: <strong>{game.status}</strong>
        {me && (
          <>
            {' | '}You: <strong>{me.name}</strong>
            {' | '}PNL: <strong>{fmt(me.balance)}</strong>
            {isMarketMaker && ' | Role: Market Maker'}
            {isHost && ' | Role: Host'}
          </>
        )}
      </p>

      {apiError && (
        <p style={{ color: 'red', margin: '8px 0' }}>{apiError}</p>
      )}

      <HouseInfo house={game.house} />

      <PlayerList game={game} />

      {game.status === 'lobby' && (
        <LobbyPanel gameId={gameId} isHost={isHost} apiCall={apiCall} />
      )}
      {game.status === 'auction' && (
        <AuctionPanel isHost={isHost} bids={bids} apiCall={apiCall} />
      )}
      {game.status === 'quoting' && (
        <QuotingPanel
          game={game}
          isMarketMaker={isMarketMaker}
          apiCall={apiCall}
        />
      )}
      {game.status === 'trading' && (
        <TradingPanel
          game={game}
          myPlayerId={myPlayerId}
          isHost={isHost}
          isMarketMaker={isMarketMaker}
          apiCall={apiCall}
        />
      )}
      {game.status === 'settlement' && (
        <SettlementPanel game={game} myPlayerId={myPlayerId} isHost={isHost} apiCall={apiCall} />
      )}
    </div>
  );
}

// --- HouseInfo ---

function HouseInfo({ house }: { house: House }) {
  const photos = house.photos ?? [];
  const streetViewEmbed = buildStreetViewEmbedUrl(house.streetViewUrl);
  return (
    <div style={{ borderTop: '1px solid #ccc', marginTop: 12, paddingTop: 12 }}>
      <h3 style={{ margin: '0 0 4px' }}>{house.address}</h3>
      <p style={{ margin: '2px 0' }}>
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
      <p style={{ margin: '2px 0' }}>
        {[
          house.yearBuilt != null ? `Built ${house.yearBuilt}` : null,
          house.daysOnZillow != null ? `${house.daysOnZillow} days on Zillow` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {house.price != null && (
        <p style={{ margin: '4px 0' }}>
          List price: <strong>${house.price.toLocaleString()}</strong>
        </p>
      )}
      <p style={{ margin: '4px 0' }}>
        {house.url && (
          <a href={house.url} target="_blank" rel="noreferrer">
            View on Zillow
          </a>
        )}
        {house.streetViewUrl && (
          <>
            {' · '}
            <a href={house.streetViewUrl} target="_blank" rel="noreferrer">
              Street View
            </a>
          </>
        )}
      </p>
      {streetViewEmbed && (
        <div style={{ marginTop: 10 }}>
          <p style={{ margin: '0 0 6px' }}>
            <strong>Street View Preview</strong>
          </p>
          <iframe
            title="Street View"
            src={streetViewEmbed}
            width="100%"
            height="260"
            style={{ border: 0, borderRadius: 8 }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      )}
      {photos.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            paddingBottom: 8,
            marginTop: 8,
          }}
        >
          {photos.map((url, i) => (
            <img
              key={i}
              src={url}
              alt={`photo ${i + 1}`}
              style={{ height: 160, width: 'auto', flexShrink: 0 }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// --- PlayerList ---

function PlayerList({ game }: { game: GameState }) {
  return (
    <div style={{ borderTop: '1px solid #ccc', marginTop: 12, paddingTop: 12 }}>
      <h4 style={{ margin: '0 0 6px' }}>Players</h4>
      <table style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', paddingRight: 20 }}>Name</th>
            <th style={{ textAlign: 'right', paddingRight: 20 }}>PNL</th>
            <th style={{ textAlign: 'left' }}>Role</th>
          </tr>
        </thead>
        <tbody>
          {game.players.map(p => (
            <tr key={p.id}>
              <td style={{ paddingRight: 20 }}>{p.name}</td>
              <td style={{ textAlign: 'right', paddingRight: 20 }}>{fmt(p.balance)}</td>
              <td>
                {[p.isHost ? 'Host' : null, p.isMarketMaker ? 'Market Maker' : null]
                  .filter(Boolean)
                  .join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- LobbyPanel ---

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
    <div style={{ borderTop: '1px solid #ccc', marginTop: 12, paddingTop: 12 }}>
      <h4 style={{ margin: '0 0 8px' }}>Lobby</h4>
      <p style={{ margin: '4px 0' }}>
        Share this room ID with other players:{' '}
        <code style={{ background: '#eee', padding: '2px 4px' }}>{gameId}</code>{' '}
        <button onClick={copyRoomId} style={{ fontSize: 12 }}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </p>
      <p style={{ margin: '4px 0', color: '#666' }}>
        Waiting for players to join...
      </p>
      {isHost && (
        <button
          onClick={startAuction}
          disabled={loading}
          style={{ marginTop: 8 }}
        >
          Start Auction
        </button>
      )}
    </div>
  );
}

// --- AuctionPanel ---

function AuctionPanel({
  isHost,
  bids,
  apiCall,
}: {
  isHost: boolean;
  bids: BidRecord[];
  apiCall: ApiCall;
}) {
  const [spreadVal, setSpreadVal] = useState('');
  const [loading, setLoading] = useState(false);

  const spreadNum = parseFloat(spreadVal);
  const valid = !isNaN(spreadNum) && spreadNum > 0;

  const sortedBids = [...bids].sort((a, b) => a.spread - b.spread);
  const minSpread = sortedBids.length > 0 ? sortedBids[0].spread : null;

  async function submitBid() {
    if (!valid) return;
    setLoading(true);
    await apiCall('/bid', { spread: spreadNum });
    setLoading(false);
  }

  async function finishAuction() {
    setLoading(true);
    await apiCall('/finish-auction');
    setLoading(false);
  }

  return (
    <div style={{ borderTop: '1px solid #ccc', marginTop: 12, paddingTop: 12 }}>
      <h4 style={{ margin: '0 0 6px' }}>Auction Phase</h4>
      <p style={{ margin: '4px 0', color: '#555' }}>
        Enter a spread. Tightest spread wins and becomes the market maker.
      </p>

      {minSpread !== null && (
        <p style={{ margin: '6px 0' }}>
          Current best spread: <strong>{fmt(minSpread)}</strong>
        </p>
      )}

      {sortedBids.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <strong>Submitted spreads:</strong>
          <table style={{ borderCollapse: 'collapse', marginTop: 4 }}>
            <tbody>
              {sortedBids.map((b, i) => (
                <tr key={i}>
                  <td style={{ paddingRight: 16 }}>{b.playerName}</td>
                  <td>{fmt(b.spread)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label>
          Spread:{' '}
          <input
            type="number"
            value={spreadVal}
            onChange={e => setSpreadVal(e.target.value)}
            style={{ width: 120 }}
            placeholder="e.g. 20000"
            onKeyDown={e => e.key === 'Enter' && submitBid()}
          />
        </label>
        <button onClick={submitBid} disabled={loading || !valid}>
          Submit
        </button>
      </div>

      {isHost && (
        <div style={{ marginTop: 12 }}>
          <button onClick={finishAuction} disabled={loading}>
            End Auction — select tightest spread as market maker
          </button>
        </div>
      )}
    </div>
  );
}

// --- QuotingPanel ---

function QuotingPanel({
  game,
  isMarketMaker,
  apiCall,
}: {
  game: GameState;
  isMarketMaker: boolean;
  apiCall: ApiCall;
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
    <div style={{ borderTop: '1px solid #ccc', marginTop: 12, paddingTop: 12 }}>
      <h4 style={{ margin: '0 0 6px' }}>Quoting Phase</h4>
      <p style={{ margin: '4px 0' }}>
        Market maker: <strong>{mm?.name}</strong> | Agreed spread:{' '}
        <strong>{agreedSpread != null ? fmt(agreedSpread) : '?'}</strong>
      </p>

      {isMarketMaker ? (
        <div style={{ marginTop: 8 }}>
          <p style={{ margin: '4px 0', color: '#555' }}>
            Enter your center price. Bid and ask will be set automatically.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <span style={{ minWidth: 140, textAlign: 'right' }}>
              {ready ? <>Bid: <strong>{fmt(bidNum!)}</strong></> : 'Bid: —'}
            </span>
            <label>
              Mid:{' '}
              <input
                type="number"
                value={centerVal}
                onChange={e => setCenterVal(e.target.value)}
                style={{ width: 120 }}
                placeholder="e.g. 350000"
                onKeyDown={e => e.key === 'Enter' && setQuotes()}
              />
            </label>
            <span style={{ minWidth: 140 }}>
              {ready ? <>Ask: <strong>{fmt(askNum!)}</strong></> : 'Ask: —'}
            </span>
            <button onClick={setQuotes} disabled={loading || !ready}>
              Set Quotes
            </button>
          </div>
        </div>
      ) : (
        <p style={{ margin: '8px 0', color: '#555' }}>
          Waiting for {mm?.name} to set their bid and ask...
        </p>
      )}
    </div>
  );
}

// --- TradingPanel ---

function TradingPanel({
  game,
  myPlayerId,
  isHost,
  isMarketMaker,
  apiCall,
}: {
  game: GameState;
  myPlayerId: string;
  isHost: boolean;
  isMarketMaker: boolean;
  apiCall: ApiCall;
}) {
  const [loading, setLoading] = useState(false);

  const myTrade = game.trades.find(t => t.playerId === myPlayerId);
  const mm = game.players.find(p => p.isMarketMaker);

  async function trade(direction: 'buy' | 'sell') {
    setLoading(true);
    await apiCall('/trade', { direction });
    setLoading(false);
  }

  async function settle() {
    setLoading(true);
    await apiCall('/settle');
    setLoading(false);
  }

  return (
    <div style={{ borderTop: '1px solid #ccc', marginTop: 12, paddingTop: 12 }}>
      <h4 style={{ margin: '0 0 6px' }}>Trading Phase</h4>
      <p style={{ margin: '4px 0' }}>
        Market Maker: <strong>{mm?.name ?? '?'}</strong>
        {' | '}
        Bid: <strong>{game.marketBid != null ? fmt(game.marketBid) : '?'}</strong>
        {' | '}
        Ask: <strong>{game.marketAsk != null ? fmt(game.marketAsk) : '?'}</strong>
        {' | '}
        Spread:{' '}
        <strong>
          {game.marketBid != null && game.marketAsk != null
            ? fmt(game.marketAsk - game.marketBid)
            : '?'}
        </strong>
      </p>

      {isMarketMaker ? (
        <p style={{ margin: '8px 0' }}>
          You are the market maker. Wait for other players to trade.
        </p>
      ) : myTrade ? (
        <p style={{ margin: '8px 0' }}>
          You {myTrade.direction === 'buy' ? 'bought' : 'sold'} at{' '}
          <strong>{fmt(myTrade.price)}</strong>. Waiting for settlement.
        </p>
      ) : (
        <div style={{ margin: '8px 0', display: 'flex', gap: 8 }}>
          <button onClick={() => trade('buy')} disabled={loading}>
            Buy at {game.marketAsk != null ? fmt(game.marketAsk) : '?'}
          </button>
          <button onClick={() => trade('sell')} disabled={loading}>
            Sell at {game.marketBid != null ? fmt(game.marketBid) : '?'}
          </button>
        </div>
      )}

      {game.trades.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <strong>Trades so far:</strong>
          <table style={{ borderCollapse: 'collapse', marginTop: 4 }}>
            <tbody>
              {game.trades.map(t => (
                <tr key={t.id}>
                  <td style={{ paddingRight: 16 }}>{playerName(game, t.playerId)}</td>
                  <td style={{ paddingRight: 16 }}>{t.direction}</td>
                  <td>{fmt(t.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isHost && (
        <div style={{ marginTop: 12 }}>
          <button onClick={settle} disabled={loading}>
            Reveal True Value &amp; Settle
          </button>
        </div>
      )}
    </div>
  );
}

// --- SettlementPanel ---

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
    <div style={{ borderTop: '1px solid #ccc', marginTop: 12, paddingTop: 12 }}>
      <h4 style={{ margin: '0 0 6px' }}>Settlement</h4>

      <p style={{ margin: '4px 0' }}>
        True value:{' '}
        <strong>
          {game.trueValue != null ? fmt(game.trueValue) : '?'}
        </strong>
      </p>

      {game.marketBid != null && game.marketAsk != null && (
        <p style={{ margin: '4px 0' }}>
          Market: <strong>{mm?.name}</strong> quoted{' '}
          {fmt(game.marketBid)} / {fmt(game.marketAsk)} (spread{' '}
          {fmt(game.marketAsk - game.marketBid)})
        </p>
      )}

      <h5 style={{ margin: '12px 0 4px' }}>Trades &amp; P&amp;L</h5>
      {game.trades.length === 0 ? (
        <p>No trades were made.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', paddingRight: 20 }}>Player</th>
              <th style={{ textAlign: 'left', paddingRight: 20 }}>Direction</th>
              <th style={{ textAlign: 'right', paddingRight: 20 }}>Price</th>
              <th style={{ textAlign: 'right' }}>P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {game.trades.map(t => (
              <tr
                key={t.id}
                style={{ fontWeight: t.playerId === myPlayerId ? 'bold' : 'normal' }}
              >
                <td style={{ paddingRight: 20 }}>{playerName(game, t.playerId)}</td>
                <td style={{ paddingRight: 20 }}>{t.direction}</td>
                <td style={{ textAlign: 'right', paddingRight: 20 }}>{fmt(t.price)}</td>
                <td
                  style={{
                    textAlign: 'right',
                    color: t.pnl != null ? (t.pnl >= 0 ? 'green' : 'red') : undefined,
                  }}
                >
                  {t.pnl != null ? pnlFmt(t.pnl) : '?'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h5 style={{ margin: '12px 0 4px' }}>PNL</h5>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {game.players.map(p => (
            <tr
              key={p.id}
              style={{ fontWeight: p.id === myPlayerId ? 'bold' : 'normal' }}
            >
              <td style={{ paddingRight: 20 }}>
                {p.name}
                {p.isMarketMaker ? ' (MM)' : ''}
              </td>
              <td style={{ color: p.balance >= 0 ? 'green' : 'red' }}>
                {pnlFmt(p.balance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        {isHost && (
          <button onClick={startNewRound} disabled={loading}>
            Next Round (new house)
          </button>
        )}
        <a href="/">Leave game</a>
      </div>
    </div>
  );
}

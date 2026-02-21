'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API = '/api';

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function createGame() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || 'Host' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to create game');
        return;
      }
      localStorage.setItem(`token:${data.gameId}`, data.token);
      localStorage.setItem(`playerId:${data.gameId}`, data.playerId);
      router.push(`/game/${data.gameId}`);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  async function joinGame() {
    const rid = roomId.trim();
    if (!rid) {
      setError('Enter a room ID');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/games/${rid}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || 'Player' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to join game');
        return;
      }
      localStorage.setItem(`token:${rid}`, data.token);
      localStorage.setItem(`playerId:${rid}`, data.playerId);
      router.push(`/game/${rid}`);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell" style={{ maxWidth: 980 }}>
      <section className="panel" style={{ padding: 24 }}>
        <p className="kicker">Real-Time Property Market</p>
        <h1 className="title" style={{ marginTop: 8 }}>Zestimator</h1>
        <p className="subtitle">Join real players and quote homes in a fast trading room, marketplace style.</p>
      </section>

      <section className="panel" style={{ marginTop: 14 }}>
        <div className="row">
          <div className="grow" style={{ minWidth: 220 }}>
            <label htmlFor="name">Your name</label>
            <input
              id="name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Scott"
              onKeyDown={e => e.key === 'Enter' && createGame()}
            />
          </div>
        </div>

        <div className="two-col" style={{ marginTop: 14 }}>
          <div className="panel" style={{ padding: 14, margin: 0 }}>
            <p className="kicker">Host</p>
            <h3 className="title" style={{ marginTop: 8, fontSize: 22 }}>Create New Game</h3>
            <p className="subtitle" style={{ marginTop: 6 }}>Start a room and become host for this session.</p>
            <button className="btn" onClick={createGame} disabled={loading} style={{ marginTop: 10 }}>
              Create Room
            </button>
          </div>

          <div className="panel" style={{ padding: 14, margin: 0 }}>
            <p className="kicker">Join</p>
            <h3 className="title" style={{ marginTop: 8, fontSize: 22 }}>Enter Existing Room</h3>
            <p className="subtitle" style={{ marginTop: 6 }}>Paste a room code shared by your host.</p>
            <label htmlFor="roomId" style={{ marginTop: 10 }}>Room ID</label>
            <input
              id="roomId"
              value={roomId}
              onChange={e => setRoomId(e.target.value)}
              placeholder="paste room id"
              onKeyDown={e => e.key === 'Enter' && joinGame()}
            />
            <button className="btn btn-secondary" onClick={joinGame} disabled={loading} style={{ marginTop: 10 }}>
              Join Room
            </button>
          </div>
        </div>

        {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
        {loading && (
          <p className="muted" style={{ marginTop: 10 }}>
            Preparing game data. First load can take around 15 seconds.
          </p>
        )}
      </section>
    </main>
  );
}

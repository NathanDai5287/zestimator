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
      if (!res.ok) { setError(data.error ?? 'Failed to create game'); return; }
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
    if (!rid) { setError('Enter a room ID'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/games/${rid}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || 'Player' }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to join game'); return; }
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
    <div style={{ padding: 24, fontFamily: 'monospace', maxWidth: 480 }}>
      <h1>Zestimator</h1>
      <p>Guess the house price. Compete to make the market.</p>

      <div style={{ marginBottom: 16 }}>
        <label>
          Your name:{' '}
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="enter name"
            onKeyDown={e => e.key === 'Enter' && createGame()}
          />
        </label>
      </div>

      <div style={{ marginBottom: 8 }}>
        <button onClick={createGame} disabled={loading}>
          Create New Game
        </button>
        <span style={{ marginLeft: 8, color: '#666', fontSize: 13 }}>you will be host</span>
      </div>

      <hr style={{ margin: '16px 0' }} />

      <div style={{ marginBottom: 8 }}>
        <label>
          Room ID:{' '}
          <input
            value={roomId}
            onChange={e => setRoomId(e.target.value)}
            placeholder="paste room id here"
            style={{ width: 280 }}
            onKeyDown={e => e.key === 'Enter' && joinGame()}
          />
        </label>
      </div>
      <button onClick={joinGame} disabled={loading}>
        Join Game
      </button>

      {error && <p style={{ color: 'red', marginTop: 8 }}>{error}</p>}
      {loading && <p style={{ color: '#666' }}>Loading (scraping house data, may take ~15s)...</p>}
    </div>
  );
}

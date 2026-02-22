'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const HouseScene = dynamic(() => import('./components/HouseScene'), {
  ssr: false,
  loading: () => <div style={{ width: '100%', height: 180 }} />,
});

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
    <div className="home-container">
      <div className="home-inner">
        <header className="home-header">
          <HouseScene />
          <h1 className="home-title">Zestimator</h1>
          <p className="home-tagline">
            Guess the house price. Compete to make the market.
          </p>
        </header>

        <div className="home-name-row">
          <label htmlFor="home-name">your name</label>
          <input
            id="home-name"
            className="home-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="enter name"
            onKeyDown={e => e.key === 'Enter' && createGame()}
          />
        </div>

        <div className="home-actions">
          <div className="home-action-col">
            <span className="home-label">new game</span>
            <p className="home-hint">Start a room. You&rsquo;ll be the host.</p>
            <button
              className="home-btn"
              onClick={createGame}
              disabled={loading}
            >
              Create Room
            </button>
          </div>

          <div className="home-divider" />

          <div className="home-action-col">
            <span className="home-label">join game</span>
            <p className="home-hint">Paste a room code from your host.</p>
            <input
              className="home-input"
              value={roomId}
              onChange={e => setRoomId(e.target.value)}
              placeholder="room id"
              onKeyDown={e => e.key === 'Enter' && joinGame()}
            />
            <button
              className="home-btn home-btn-outline"
              onClick={joinGame}
              disabled={loading}
            >
              Join Room
            </button>
          </div>
        </div>

        {error && <p className="home-error">{error}</p>}
        {loading && (
          <p className="home-loading">
            Scraping house data &mdash; this can take ~15 s&hellip;
          </p>
        )}
      </div>
    </div>
  );
}

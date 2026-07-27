import { FormEvent, useState } from 'react';
import { setupApi } from '../api/client';

const POLL_INTERVAL_MS = 1500;

export function FirstRunSetupPage() {
  const [username, setUsername] = useState('');
  const [phase, setPhase] = useState<'idle' | 'registering' | 'restarting'>('idle');
  const [error, setError] = useState<string | null>(null);

  const pollUntilProvisioned = () => {
    const poll = async () => {
      try {
        const status = await setupApi.status();
        if (status.provisioned) {
          window.location.reload();
          return;
        }
      } catch {
        // gateway is mid-restart -- expected, keep polling
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPhase('registering');
    try {
      const res = await setupApi.register(username);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(payload.error || `request failed with status ${res.status}`);
      }
      setPhase('restarting');
      pollUntilProvisioned();
    } catch (err) {
      setError((err as Error).message);
      setPhase('idle');
    }
  };

  if (phase === 'restarting') {
    return (
      <div className="card">
        <h2>Setting up this device…</h2>
        <p>Registering '{username}' and starting the app. This takes a few seconds.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Register this device</h2>
      <p>Enter the username this device will act as. This can only be set once.</p>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={phase === 'registering'}
            required
          />
        </div>
        <button type="submit" disabled={phase === 'registering'}>
          {phase === 'registering' ? 'Registering…' : 'Register'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

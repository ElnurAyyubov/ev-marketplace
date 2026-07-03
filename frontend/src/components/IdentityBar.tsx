import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useIdentity } from '../context/IdentityContext';
import { Identity } from '../api/types';

const IDENTITIES: Identity[] = ['admin', 'alice', 'bob', 'provider1'];

export function IdentityBar() {
  const { identity, setIdentity } = useIdentity();
  const [balance, setBalance] = useState<number | null>(null);
  const [faucetAmount, setFaucetAmount] = useState(500);
  const [busy, setBusy] = useState(false);

  const refreshBalance = () => {
    api
      .getBalance(identity, identity)
      .then((res) => setBalance(res.balance))
      .catch(() => setBalance(null));
  };

  useEffect(refreshBalance, [identity]);

  const handleFaucet = async () => {
    setBusy(true);
    try {
      await api.faucet('admin', identity, faucetAmount);
      refreshBalance();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="identity-bar">
      <label>
        Acting as:{' '}
        <select value={identity} onChange={(e) => setIdentity(e.target.value as Identity)}>
          {IDENTITIES.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      <span>Balance: {balance === null ? '—' : balance}</span>
      <input
        type="number"
        value={faucetAmount}
        onChange={(e) => setFaucetAmount(Number(e.target.value))}
        style={{ width: 80 }}
      />
      <button onClick={handleFaucet} disabled={busy}>
        Faucet (dev)
      </button>
    </div>
  );
}

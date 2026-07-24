import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useIdentity } from '../context/IdentityContext';
import { Identity } from '../api/types';


export function IdentityBar() {
  const { identity } = useIdentity();
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshBalance = () => {
    api
      .getBalance(identity, identity)
      .then((res) => setBalance(res.balance))
      .catch(() => setBalance(null));
  };

  useEffect(refreshBalance, [identity]);


  return (
    <div className="identity-bar">
      <label>
        Acting as:{identity}
      </label>
      <span>Balance: {balance === null ? '—' : balance}</span>
    </div>
  );
}

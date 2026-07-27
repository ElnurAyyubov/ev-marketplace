import { useEffect, useState } from 'react';
import App from './App';
import { setupApi } from './api/client';
import { IdentityProvider } from './context/IdentityContext';
import { FirstRunSetupPage } from './pages/FirstRunSetupPage';

const BUILD_TIME_IDENTITY = import.meta.env.VITE_USER_ID as string | undefined;

export function ProvisioningGate() {
  const [state, setState] = useState<'loading' | 'unprovisioned' | string>(
    BUILD_TIME_IDENTITY ?? 'loading'
  );

  useEffect(() => {
    if (BUILD_TIME_IDENTITY) return;
    setupApi
      .status()
      .then((s) => setState(s.provisioned ? s.identity : 'unprovisioned'))
      .catch(() => setState('unprovisioned'));
  }, []);

  if (state === 'loading') return <div className="card">Loading…</div>;
  if (state === 'unprovisioned') return <FirstRunSetupPage />;
  return (
    <IdentityProvider identity={state}>
      <App />
    </IdentityProvider>
  );
}

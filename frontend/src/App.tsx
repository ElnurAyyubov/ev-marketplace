import { useState } from 'react';
import { IdentityBar } from './components/IdentityBar';
import { CreateProviderPage } from './pages/CreateProviderPage';
import { MarketplacePage } from './pages/MarketplacePage';
import { MyReservationsPage } from './pages/MyReservationsPage';
import { ProviderDetailPage } from './pages/ProviderDetailPage';
import { ProviderOwnerPage } from './pages/ProviderOwnerPage';
import { RegisterPage } from './pages/RegisterPage';
import { TripPlannerPage } from './pages/TripPlannerPage';

type Tab = 'register' | 'marketplace' | 'trip-planner' | 'create-provider' | 'my-reservations' | 'owner';

const TABS: { id: Tab; label: string }[] = [
  { id: 'register', label: 'Register User' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'trip-planner', label: 'Trip Planner' },
  { id: 'create-provider', label: 'Create Provider' },
  { id: 'my-reservations', label: 'My Reservations' },
  { id: 'owner', label: 'Provider Owner View' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('marketplace');
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

  return (
    <div className="app">
      <h1>EV Charging Marketplace</h1>
      <IdentityBar />
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => {
              setTab(t.id);
              setSelectedProviderId(null);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'register' && <RegisterPage />}
      {tab === 'create-provider' && <CreateProviderPage />}
      {tab === 'my-reservations' && <MyReservationsPage />}
      {tab === 'owner' && <ProviderOwnerPage />}
      {(tab === 'marketplace' || tab === 'trip-planner') &&
        (selectedProviderId ? (
          <ProviderDetailPage
            providerId={selectedProviderId}
            onBack={() => setSelectedProviderId(null)}
            onReserved={() => {
              /* reservation created; visible under My Reservations */
            }}
          />
        ) : tab === 'marketplace' ? (
          <MarketplacePage onSelectProvider={setSelectedProviderId} />
        ) : (
          <TripPlannerPage onSelectProvider={setSelectedProviderId} />
        ))}
    </div>
  );
}

import { createContext, ReactNode, useContext, useState } from 'react';
import { Identity } from '../api/types';

const IDENTITY = import.meta.env.VITE_USER_ID

interface IdentityContextValue {
  identity: Identity;
}

const IdentityContext = createContext<IdentityContextValue | undefined>(undefined);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [identity] = useState<Identity>(IDENTITY);
  return (
    <IdentityContext.Provider value={{ identity }}>
      {children}
    </IdentityContext.Provider>
  );
}

export function useIdentity(): IdentityContextValue {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error('useIdentity must be used within an IdentityProvider');
  return ctx;
}

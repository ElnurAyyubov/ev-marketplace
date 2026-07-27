import { createContext, ReactNode, useContext } from 'react';
import { Identity } from '../api/types';

interface IdentityContextValue {
  identity: Identity;
}

const IdentityContext = createContext<IdentityContextValue | undefined>(undefined);

interface IdentityProviderProps {
  identity: Identity;
  children: ReactNode;
}

export function IdentityProvider({ identity, children }: IdentityProviderProps) {
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

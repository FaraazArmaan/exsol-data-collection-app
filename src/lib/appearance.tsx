import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Appearance = 'system' | 'light' | 'dark';

interface AppearanceContextValue {
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
}

const STORAGE_KEY = 'exsol.appearance';
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function initialAppearance(): Appearance {
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(initialAppearance);

  useEffect(() => {
    if (appearance === 'system') {
      delete document.documentElement.dataset.theme;
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      document.documentElement.dataset.theme = appearance;
      window.localStorage.setItem(STORAGE_KEY, appearance);
    }
  }, [appearance]);

  const value = useMemo(() => ({ appearance, setAppearance }), [appearance]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('useAppearance outside AppearanceProvider');
  return value;
}

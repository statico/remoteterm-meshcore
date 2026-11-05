import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { DistanceUnit } from '../utils/distanceUnits';

interface DistanceUnitContextValue {
  distanceUnit: DistanceUnit;
  setDistanceUnit: (unit: DistanceUnit) => void;
}

const noop = () => {};

const DistanceUnitContext = createContext<DistanceUnitContextValue>({
  distanceUnit: 'metric',
  setDistanceUnit: noop,
});

export function DistanceUnitProvider({
  distanceUnit,
  setDistanceUnit,
  children,
}: DistanceUnitContextValue & { children: ReactNode }) {
  const value = useMemo(() => ({ distanceUnit, setDistanceUnit }), [distanceUnit, setDistanceUnit]);
  return <DistanceUnitContext.Provider value={value}>{children}</DistanceUnitContext.Provider>;
}

export function useDistanceUnit() {
  return useContext(DistanceUnitContext);
}

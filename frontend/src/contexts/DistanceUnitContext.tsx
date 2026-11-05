import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import {
  getSavedDistanceUnit,
  setSavedDistanceUnit,
  type DistanceUnit,
} from '../utils/distanceUnits';

interface DistanceUnitContextValue {
  distanceUnit: DistanceUnit;
  setDistanceUnit: (unit: DistanceUnit) => void;
}

const DistanceUnitContext = createContext<DistanceUnitContextValue>({
  distanceUnit: 'metric',
  setDistanceUnit: () => {},
});

export function DistanceUnitProvider({ children }: { children: ReactNode }) {
  const [distanceUnit, setState] = useState(getSavedDistanceUnit);
  const setDistanceUnit = useCallback((unit: DistanceUnit) => {
    setState(unit);
    setSavedDistanceUnit(unit);
  }, []);
  const value = useMemo(() => ({ distanceUnit, setDistanceUnit }), [distanceUnit, setDistanceUnit]);
  return <DistanceUnitContext.Provider value={value}>{children}</DistanceUnitContext.Provider>;
}

export function useDistanceUnit() {
  return useContext(DistanceUnitContext);
}

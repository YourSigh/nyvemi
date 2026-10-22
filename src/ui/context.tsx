import { createContext,useContext } from 'react';
import type { Runtime } from '../application/runtime';
export const RuntimeContext=createContext<Runtime|null>(null);
export function useRuntime():Runtime{const value=useContext(RuntimeContext);if(!value)throw new Error('App 未初始化');return value;}

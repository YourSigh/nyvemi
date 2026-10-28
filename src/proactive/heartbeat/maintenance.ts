/** Finite maintenance tick; no UI lifecycle, long JS sleep or JS interval is involved. */
export interface MaintenancePorts {
  requested(): Promise<void>;
  continuations(): Promise<void>;
  reconnects(): Promise<void>;
  cycle(): Promise<void>;
  sync(): Promise<void>;
  idle(): Promise<void>;
  error(operation: string): Promise<void>;
}
export async function runMaintenance(ports: MaintenancePorts, full: boolean): Promise<boolean> {
  let success = true;
  const attempt = async (operation: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch {
      success = false;
      await ports.error(operation).catch(() => undefined);
    }
  };
  // One failed task category must not starve unrelated deliveries or the durable registration.
  await attempt('maintenance_requested', ports.requested);
  await attempt('maintenance_continuations', ports.continuations);
  await attempt('maintenance_reconnects', ports.reconnects);
  if (full) await attempt('maintenance_cycle', ports.cycle);
  await attempt('maintenance_sync', ports.sync);
  await attempt('maintenance_idle', ports.idle);
  return success;
}

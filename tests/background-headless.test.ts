import { it, expect, vi, beforeEach } from 'vitest';
import { registerHeartbeat } from '../src/native/background';
const mocks = vi.hoisted(() => ({
  tasks: new Map<string, () => (data: unknown) => Promise<void>>(),
  getRuntime: vi.fn(),
  cycle: vi.fn(),
  register: vi.fn(),
  complete: vi.fn(),
  registered: vi.fn(),
  unregister: vi.fn(),
}));
vi.mock('react-native', () => ({
  AppState: { currentState: 'background' },
  AppRegistry: {
    registerHeadlessTask: (name: string, factory: () => (data: unknown) => Promise<void>) =>
      mocks.tasks.set(name, factory),
  },
}));
vi.mock('expo-task-manager', () => ({
  defineTask: vi.fn(),
  isTaskRegisteredAsync: mocks.registered,
}));
vi.mock('expo-background-task', () => ({
  unregisterTaskAsync: mocks.unregister,
  BackgroundTaskResult: { Success: 1, Failed: 2 },
}));
vi.mock('../src/native/android', () => ({
  bridge: () => ({
    registerMaintenance: mocks.register,
    completeMaintenanceRun: mocks.complete,
    presenceState: () => ({ running: false }),
  }),
}));
vi.mock('../src/application/runtime', () => ({ getRuntime: mocks.getRuntime }));
vi.mock('../src/proactive/heartbeat/driver', () => ({ runBackgroundCycle: mocks.cycle }));
function runtime() {
  return {
    heartbeat: { runRequested: vi.fn(), runContinuations: vi.fn(), runReconnects: vi.fn() },
    syncIntentionWork: vi.fn(),
    diagnostics: {
      record: vi.fn().mockResolvedValue(undefined),
      error: vi.fn().mockResolvedValue(undefined),
    },
    activity: { subscribe: vi.fn().mockReturnValue(vi.fn()) },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
});
it('cold-starts the finite headless callback while backgrounded and acknowledges actual completion', async () => {
  const r = runtime();
  mocks.getRuntime.mockResolvedValue(r);
  await mocks.tasks.get('NyvemiMaintenance')!()({
    runId: 'r',
    full: true,
    source: 'periodic_worker',
  });
  expect(r.heartbeat.runRequested).toHaveBeenCalledOnce();
  expect(mocks.cycle).toHaveBeenCalledWith(r);
  expect(mocks.complete).toHaveBeenCalledWith('r', true);
  expect(r.diagnostics.record).toHaveBeenCalledWith(
    'heartbeat',
    '',
    expect.objectContaining({ event: 'maintenance_finish', appState: 'background', success: true }),
  );
  expect(r.activity.subscribe.mock.results[0].value).toHaveBeenCalledOnce();
});
it('returns a failure receipt when cold runtime initialization fails instead of reporting delivery', async () => {
  mocks.getRuntime.mockRejectedValue(new Error('fixture only'));
  await mocks.tasks.get('NyvemiMaintenance')!()({
    runId: 'failed',
    full: false,
    source: 'presence_service',
  });
  expect(mocks.complete).toHaveBeenCalledWith('failed', false);
});
it('keeps a native fast tick independent of the full extraction/experience cycle', async () => {
  mocks.getRuntime.mockResolvedValue(runtime());
  await mocks.tasks.get('NyvemiMaintenance')!()({
    runId: 'fast',
    full: false,
    source: 'presence_service',
  });
  expect(mocks.cycle).not.toHaveBeenCalled();
  expect(mocks.complete).toHaveBeenCalledWith('fast', true);
});
it('registers native durable recovery before removing the old hourly job', async () => {
  const log: string[] = [];
  mocks.register.mockImplementation(async () => {
    log.push('native');
  });
  mocks.registered.mockResolvedValue(true);
  mocks.unregister.mockImplementation(async () => {
    log.push('remove-old');
  });
  await registerHeartbeat();
  expect(log).toEqual(['native', 'remove-old']);
});
it('retains the old periodic job if native registration fails', async () => {
  mocks.register.mockRejectedValueOnce(new Error('fixture only'));
  await expect(registerHeartbeat()).rejects.toThrow('fixture only');
  expect(mocks.unregister).not.toHaveBeenCalled();
});

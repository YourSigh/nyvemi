import { AppRegistry } from 'react-native';
import { bridge } from './android';
import { getRuntime } from '../application/runtime';
import { executeRequestedWork } from '../proactive/requested-delivery';

AppRegistry.registerHeadlessTask(
  'NyvemiRequestedDelivery',
  () => async (data: { intentionId: string; runId: string }) => {
    let done = false;
    try {
      const runtime = await getRuntime();
      done = await executeRequestedWork(
        runtime.store,
        (id) => runtime.heartbeat.runRequested(id),
        data.intentionId,
      );
    } catch {
      // Native WorkManager retries failures, including cold JS startup/storage failures.
    } finally {
      bridge().completeRequestedRun(data.runId, done);
    }
  },
);

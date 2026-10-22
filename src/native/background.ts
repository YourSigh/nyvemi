import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { getRuntime } from '../application/runtime';
import { runBackgroundCycle } from '../proactive/heartbeat/driver';
export const HEARTBEAT_TASK='nyvemi.heartbeat.v1';
TaskManager.defineTask(HEARTBEAT_TASK,async()=>{try{await runBackgroundCycle(await getRuntime());return BackgroundTask.BackgroundTaskResult.Success;}catch{return BackgroundTask.BackgroundTaskResult.Failed;}});
export async function registerHeartbeat():Promise<void>{if(!await TaskManager.isTaskRegisteredAsync(HEARTBEAT_TASK))await BackgroundTask.registerTaskAsync(HEARTBEAT_TASK,{minimumInterval:60});}

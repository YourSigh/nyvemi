import { useEffect,useState } from 'react';
import { NavigationContainer,DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider,SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { getRuntime,type Runtime } from './src/application/runtime';
import { RuntimeContext } from './src/ui/context';
import { Busy,Button,ErrorText,Page,palette } from './src/ui/components';
import { WelcomeScreen,ProviderScreen,CreateScreen,GenerateScreen } from './src/ui/onboarding';
import { ChatScreen } from './src/ui/chat';
import { SettingsScreen,CharactersScreen } from './src/ui/settings';
import type { Routes } from './src/ui/navigation';
const Stack=createNativeStackNavigator<Routes>();
export default function App(){
 const [runtime,setRuntime]=useState<Runtime>();const [initial,setInitial]=useState<string>();const [ready,setReady]=useState(false);const [error,setError]=useState('');const [attempt,setAttempt]=useState(0);
 useEffect(()=>{let live=true;void getRuntime().then(async r=>{const chars=await r.store.list('characters');if(live){setRuntime(r);setInitial(chars[0]?.id);setReady(true);}}).catch(()=>{if(live)setError('无法载入本地资料。请重试；不会清空已有数据。');});return()=>{live=false;};},[attempt]);
 return <SafeAreaProvider><StatusBar style="dark"/><SafeAreaView edges={['top']} style={{flex:1,backgroundColor:palette.background}}>{error?<Page><ErrorText text={error}/><Button title="重试" onPress={()=>{setError('');setAttempt(n=>n+1);}}/></Page>:!runtime||!ready?<Busy/>:<RuntimeContext.Provider value={runtime}><NavigationContainer theme={{...DefaultTheme,colors:{...DefaultTheme.colors,background:palette.background,card:palette.background,text:palette.ink,primary:palette.accent,border:palette.line}}} linking={{prefixes:['nyvemi://'],config:{screens:{Chat:'chat/:characterId'}}}}><Stack.Navigator initialRouteName={initial?'Chat':'Welcome'} screenOptions={{headerShadowVisible:false,headerBackTitle:'返回',contentStyle:{backgroundColor:palette.background}}}><Stack.Screen name="Welcome" component={WelcomeScreen} options={{headerShown:false}}/><Stack.Screen name="Provider" component={ProviderScreen} options={{title:'模型连接'}}/><Stack.Screen name="Create" component={CreateScreen} options={{title:'创建角色'}}/><Stack.Screen name="Generate" component={GenerateScreen} options={{title:'认识她',headerBackVisible:false,gestureEnabled:false}}/><Stack.Screen name="Chat" component={ChatScreen} initialParams={initial?{characterId:initial}:undefined} options={{headerShown:false}}/><Stack.Screen name="Settings" component={SettingsScreen} options={{title:'关于她'}}/><Stack.Screen name="Characters" component={CharactersScreen} options={{title:'角色'}}/></Stack.Navigator></NavigationContainer></RuntimeContext.Provider>}</SafeAreaView></SafeAreaProvider>;
}

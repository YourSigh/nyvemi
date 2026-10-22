import { useCallback,useState } from 'react';
import { Linking,Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { Experience } from '../domain/models';
import { Button,Card,ErrorText,Heading,Note,Page } from './components';
import { useRuntime } from './context';
import type { ScreenProps } from './navigation';
const timeLabels:Record<string,string>={morning:'一个新的早晨',afternoon:'午后时分',evening:'天色渐晚','late night':'夜深了',weekend:'周末的空气'};
export function ExperiencesScreen({route}:ScreenProps<'Experiences'>){const runtime=useRuntime();const [items,setItems]=useState<Experience[]>([]);const [error,setError]=useState('');useFocusEffect(useCallback(()=>{void runtime.store.list('experiences',route.params.characterId,100).then(setItems).catch(()=>setError('读取经历失败'));},[runtime,route.params.characterId]));return <Page><Heading>她遇到的事</Heading><Note>有些只留在她自己这里，有些会让她想起你。经历不等于新闻推荐，也不代表意识。</Note><ErrorText text={error}/>{items.length?items.map(e=><Card key={e.id}><Note>{new Date(e.createdAt).toLocaleString()} · {e.source.startsWith('rss:')?'从订阅中遇见':e.source==='conversation'?'你们聊过':'此时此地'}</Note><Text style={{fontSize:17,fontWeight:'500'}}>{timeLabels[e.title]??e.title}</Text>{e.source!=='local-time'?<Note>{e.content.slice(0,240)}</Note>:null}{e.url?<Button title="查看来源" secondary onPress={()=>{void Linking.openURL(e.url!).catch(()=>setError('无法打开来源链接'));}}/>:null}</Card>):<Note>暂时还没有新的经历。相处和时间会慢慢留下痕迹。</Note>}</Page>;}

import { Directory,File,Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import type { Storage } from '../storage/store';
import { CharacterBundleService,type BundleAssets } from './bundle';
import { id } from '../domain/models';
const avatars=()=>{const dir=new Directory(Paths.document,'avatars');dir.create({idempotent:true,intermediates:true});return dir;};
export const bundleAssets:BundleAssets={readAvatar:uri=>new File(uri).bytes(),writeAvatar:async(cid,bytes)=>{const file=new File(avatars(),`${cid}-${id()}.bin`);file.write(bytes);return file.uri;},removeAvatar:async uri=>{const file=new File(uri);if(file.exists)file.delete();}};
export function bundleService(store:Storage):CharacterBundleService{return new CharacterBundleService(store,bundleAssets);}
export async function pickAvatar(store:Storage,characterId:string):Promise<string|undefined>{const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsEditing:true,aspect:[1,1],quality:0.8});if(result.canceled)return undefined;const asset=result.assets[0];const source=new File(asset.uri);if(source.size>5*1024*1024)throw new Error('请使用小于 5 MB 的头像');const uri=await bundleAssets.writeAvatar(characterId,await source.bytes());try{await store.atomic(async tx=>{const c=await tx.get('characters',characterId);if(!c)throw new Error('角色不存在');await tx.put('characters',{...c,avatar:uri});});return uri;}catch(error){await bundleAssets.removeAvatar(uri);throw error;}}
export function saveBundleToCache(bytes:Uint8Array):string{const file=new File(Paths.cache,`character-${id()}.nyvemi`);file.write(bytes);return file.uri;}

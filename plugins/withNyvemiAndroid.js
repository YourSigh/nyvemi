const { withAndroidManifest,withDangerousMod } = require('expo/config-plugins');
const fs=require('node:fs/promises');
const path=require('node:path');
module.exports=function withNyvemiAndroid(config){
 config=withAndroidManifest(config,c=>{const app=c.modResults.manifest.application[0];app.$['android:usesCleartextTraffic']='true';return c;});
 return withDangerousMod(config,['android',async c=>{const dir=path.join(c.modRequest.platformProjectRoot,'app/src/main/res/drawable');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'nyvemi_notification.xml'),'<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24"><path android:fillColor="#FFFFFFFF" android:pathData="M4,4L8,4L16,15L16,4L20,4L20,20L16,20L8,9L8,20L4,20Z"/></vector>');return c;}]);
};

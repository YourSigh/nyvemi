"""Run from repo root with existing official OpenVoice Python environment.
No model weights needed. Writes synthetic audio and classes only to --output.
"""
import argparse, json, subprocess, sys
from pathlib import Path
import numpy as np
import librosa
import torch
p=argparse.ArgumentParser();p.add_argument('--official-root',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--cached-pcm',type=Path);a=p.parse_args()
sys.path.insert(0,a.official_root)
from openvoice.mel_processing import spectrogram_torch
a.output.mkdir(parents=True,exist_ok=True)
subprocess.run(['javac','-d',str(a.output),'tools/openvoice-android/AudioFrontend.java','tools/openvoice-android/AudioFrontendTest.java'],check=True)
report=[]
for rate in (16000,22050,24000,44100,48000):
 t=np.arange(rate*2)/rate
 x=(.15*np.sin(2*np.pi*330*t)+.05*np.sin(2*np.pi*3000*t))
 pcm=(x*32768).astype('<i2');f=a.output/f'{rate}.pcm';pcm.tofile(f)
 cases=[(str(rate),f,rate)]
 if rate==24000 and a.cached_pcm:cases.append(('speech',a.cached_pcm,rate))
 for name,f,sr in cases:
  prefix=a.output/name
  subprocess.run(['java','-cp',str(a.output),'app.nyvemi.openvoice.AudioFrontendTest',str(f),str(sr),str(prefix)],check=True)
  source=np.fromfile(f,dtype='<i2').astype(np.float32)/32768
  y=np.fromfile(str(prefix)+'.resampled.f32',dtype='<f4')
  official_resampled=librosa.resample(source,orig_sr=sr,target_sr=22050)
  ref=spectrogram_torch(torch.from_numpy(y)[None],1024,22050,256,1024,center=False).numpy().reshape(-1)
  actual=np.fromfile(str(prefix)+'.spec.f32',dtype='<f4')
  transpose=np.fromfile(str(prefix)+'.transpose.f32',dtype='<f4')
  assert np.array_equal(transpose.reshape(-1,513),actual.reshape(513,-1).T)
  stft_max=float(np.max(np.abs(actual-ref)));assert stft_max<.0001,stft_max
  delta=y-official_resampled
  stats={'case':name,'stft_max_abs_error':stft_max,'resampler_max_abs_error_vs_soxr_hq':float(abs(delta).max()),'resampler_rmse_vs_soxr_hq':float(np.sqrt(np.mean(delta**2))),'samples':len(y)}
  report.append(stats)
(a.output/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))

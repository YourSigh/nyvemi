"""Self-export official OpenVoice V2. No downloaded community graphs or code.
Explicit noise preserves the official tau=.3 equation and allows paired parity.
Converter only: watermark is a separate stage, not silently removed here.
"""
import argparse, hashlib, json, sys, time
from pathlib import Path
import numpy as np
import torch

p=argparse.ArgumentParser()
p.add_argument('--official-root',type=Path,required=True)
p.add_argument('--checkpoint-dir',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
p.add_argument('--pcm',type=Path,required=True)
a=p.parse_args()
sys.path.insert(0,str(a.official_root))
from openvoice.api import OpenVoiceBaseClass
from openvoice.mel_processing import spectrogram_torch
import librosa
import onnxruntime as ort
ckpt=a.checkpoint_dir/'checkpoint.pth'
sha=hashlib.sha256(ckpt.read_bytes()).hexdigest()
assert sha=='9652c27e92b6b2a91632590ac9962ef7ae2b712e5c5b7f4c34ec55ee2b37ab9e',sha
a.output.mkdir(parents=True,exist_ok=True)
torch.set_num_threads(4)
torch.manual_seed(123)
base=OpenVoiceBaseClass(str(a.checkpoint_dir/'config.json'),device='cpu')
base.load_ckpt(str(ckpt)); model=base.model

class Encoder(torch.nn.Module):
    def __init__(self,m): super().__init__(); self.ref=m.ref_enc
    def forward(self,spec): return self.ref(spec).unsqueeze(-1)

class Converter(torch.nn.Module):
    def __init__(self,m): super().__init__(); self.m=m
    def forward(self,spec,lengths,source,target,noise,tau):
        m=self.m
        _,mean,logs,mask=m.enc_q(spec,lengths,g=source if not m.zero_g else torch.zeros_like(source),tau=0.)
        z=(mean+noise*tau*torch.exp(logs))*mask
        zp=m.flow(z,mask,g=source)
        zh=m.flow(zp,mask,g=target,reverse=True)
        return m.dec(zh*mask,g=target if not m.zero_g else torch.zeros_like(target))

def spec(x):
    return spectrogram_torch(torch.from_numpy(x.astype(np.float32))[None],1024,22050,256,1024,center=False)

pcm=np.fromfile(a.pcm,dtype='<i2').astype(np.float32)/32768
speech=librosa.resample(pcm,orig_sr=24000,target_sr=22050)
t=np.arange(22050*2)/22050
ref=(.10*np.sin(2*np.pi*220*t)+.04*np.sin(2*np.pi*440*t)).astype(np.float32)
enc=Encoder(model).eval(); conv=Converter(model).eval()
with torch.no_grad():
    source_spec=spec(speech); ref_spec=spec(ref)
    source=enc(source_spec.transpose(1,2)); target=enc(ref_spec.transpose(1,2))
    inputs=(source_spec,torch.tensor([source_spec.shape[2]]),source,target,torch.randn(1,192,source_spec.shape[2]),torch.tensor([.3]))
    torch.onnx.export(enc,(ref_spec.transpose(1,2),),str(a.output/'tone_encoder.onnx'),input_names=['spec'],output_names=['embedding'],dynamic_axes={'spec':{1:'frames'}},opset_version=17,dynamo=False)
    torch.onnx.export(conv,inputs,str(a.output/'tone_converter.onnx'),input_names=['spec','lengths','source','target','noise','tau'],output_names=['audio'],dynamic_axes={'spec':{2:'frames'},'noise':{2:'frames'},'audio':{2:'samples'}},opset_version=17,dynamo=False)
    opts=ort.SessionOptions();opts.intra_op_num_threads=4
    es=ort.InferenceSession(str(a.output/'tone_encoder.onnx'),opts,providers=['CPUExecutionProvider'])
    cs=ort.InferenceSession(str(a.output/'tone_converter.onnx'),opts,providers=['CPUExecutionProvider'])
    report={'checkpoint_sha256':sha,'watermark':'separate stage; not part of converter graph','tau':.3,'cases':[]}
    for seconds in (1.,len(speech)/22050):
        s=spec(speech[:int(seconds*22050)])
        torch.manual_seed(123)
        noise=torch.randn(1,192,s.shape[2]); lengths=torch.tensor([s.shape[2]])
        ins=(s,lengths,source,target,noise,torch.tensor([.3]))
        # Official code consumes precisely the same first randn_like after seed.
        torch.manual_seed(123)
        official=model.voice_conversion(s,lengths,source,target,tau=.3)[0].numpy()
        ours=conv(*ins).numpy()
        assert np.max(np.abs(official-ours))<1e-6
        names=['spec','lengths','source','target','noise','tau']
        feed={n:v.numpy() for n,v in zip(names,ins)}
        begin=time.monotonic(); out=cs.run(None,feed)[0];elapsed=time.monotonic()-begin
        err=float(np.max(np.abs(out-official)));rmse=float(np.sqrt(np.mean((out-official)**2)))
        assert np.isfinite(out).all() and err<.005,(err,rmse)
        case=a.output/f'case-{seconds:.2f}';case.mkdir(exist_ok=True)
        manifest={'model':'../tone_converter.onnx','inputs':{},'output':'android-output.f32','sample_rate':22050}
        for n,v in feed.items():
            ext='i64' if v.dtype==np.int64 else 'f32'; v.astype('<i8' if ext=='i64' else '<f4').tofile(case/f'{n}.{ext}')
            manifest['inputs'][n]={'file':f'{n}.{ext}','dtype':'int64' if ext=='i64' else 'float32','shape':list(v.shape)}
        official.astype('<f4').tofile(case/'python-output.f32')
        (case/'manifest.json').write_text(json.dumps(manifest,indent=2))
        report['cases'].append({'seconds':seconds,'samples':int(out.size),'desktop_ort_seconds':elapsed,'max_abs_error':err,'rmse':rmse})
    expected=target.numpy();got=es.run(None,{'spec':ref_spec.transpose(1,2).numpy()})[0]
    case=a.output/'case-encoder';case.mkdir(exist_ok=True)
    ref_spec.transpose(1,2).numpy().astype('<f4').tofile(case/'spec.f32')
    expected.astype('<f4').tofile(case/'python-output.f32')
    (case/'manifest.json').write_text(json.dumps({'model':'../tone_encoder.onnx','inputs':{'spec':{'file':'spec.f32','dtype':'float32','shape':list(ref_spec.transpose(1,2).shape)}},'output':'android-output.f32'},indent=2))
    report['encoder_max_abs_error']=float(np.max(np.abs(got-expected)))
    assert report['encoder_max_abs_error']<.001
    (a.output/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2),flush=True)

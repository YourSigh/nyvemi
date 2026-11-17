import ai.onnxruntime.*;
import app.nyvemi.openvoice.AudioFrontend;
import org.json.*;
import java.io.*;
import java.nio.*;
import java.nio.file.*;
import java.util.*;

/** Complete offline WAV-to-WAV proof; no network, Android app, or cloud service. */
public final class OpenVoiceWav {
  static float[] flatten(OnnxTensor t){FloatBuffer f=t.getFloatBuffer();float[] a=new float[f.remaining()];f.get(a);return a;}
  static OnnxTensor tensor(OrtEnvironment env,float[] values,long...shape)throws Exception{
    ByteBuffer b=ByteBuffer.allocateDirect(values.length*4).order(ByteOrder.nativeOrder());b.asFloatBuffer().put(values);
    return OnnxTensor.createTensor(env,b.asFloatBuffer(),shape);
  }
  static void raw(File f,float[] a)throws Exception{
    ByteBuffer b=ByteBuffer.allocate(a.length*4).order(ByteOrder.LITTLE_ENDIAN);for(float v:a)b.putFloat(v);Files.write(f.toPath(),b.array());
  }
  static void input(JSONObject manifest,String name,String file,String dtype,long...shape)throws Exception{
    JSONObject x=new JSONObject();x.put("file",file);x.put("dtype",dtype);x.put("shape",new JSONArray(shape));manifest.getJSONObject("inputs").put(name,x);
  }
  static float[] transpose(float[] a,int frames){float[] b=new float[a.length];for(int f=0;f<513;f++)for(int t=0;t<frames;t++)b[t*513+f]=a[f*frames+t];return b;}
  static float[] encode(OrtEnvironment env,OrtSession session,float[] spec,int frames)throws Exception{
    try(OnnxTensor t=tensor(env,transpose(spec,frames),1,frames,513);OrtSession.Result result=session.run(Collections.singletonMap("spec",t))){return flatten((OnnxTensor)result.get(0));}
  }
  public static void main(String[] args)throws Exception {
    if(args.length!=1)throw new IllegalArgumentException("Expected model and WAV directory");
    File root=new File(args[0]).getCanonicalFile(),out=new File(root,"wav-case");out.mkdirs();
    JSONObject report=new JSONObject();report.put("ort",OrtEnvironment.getEnvironment().getVersion());report.put("cpu_threads",4);report.put("tau",.3);report.put("watermark","converter-only, no watermark stage applied");
    long start=System.nanoTime();
    AudioFrontend.Audio sourceAudio=AudioFrontend.readWav(Files.readAllBytes(new File(root,"source.wav").toPath()));
    AudioFrontend.Audio referenceAudio=AudioFrontend.readWav(Files.readAllBytes(new File(root,"reference.wav").toPath()));
    float[] sourcePcm=AudioFrontend.resample(sourceAudio.samples,sourceAudio.rate);
    float[] referencePcm=AudioFrontend.resample(referenceAudio.samples,referenceAudio.rate);
    float[] spec=AudioFrontend.spectrogram(sourcePcm).frequencyMajor,refSpec=AudioFrontend.spectrogram(referencePcm).frequencyMajor;
    int frames=spec.length/513,refFrames=refSpec.length/513;
    report.put("frontend_ms",OpenVoiceBench.ms(start));report.put("source_samples",sourcePcm.length);report.put("reference_samples",referencePcm.length);
    raw(new File(out,"source-pcm.f32"),sourcePcm);raw(new File(out,"reference-pcm.f32"),referencePcm);
    raw(new File(out,"spec.f32"),spec);raw(new File(out,"reference-spec.f32"),refSpec);
    OrtEnvironment env=OrtEnvironment.getEnvironment();env.setTelemetry(false);
    try(OrtSession.SessionOptions options=new OrtSession.SessionOptions()){
      options.setIntraOpNumThreads(4);options.setInterOpNumThreads(1);options.setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL);
      options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
      start=System.nanoTime();float[] source,target;
      try(OrtSession encoder=env.createSession(new File(root,"tone_encoder.onnx").getPath(),options)){
        report.put("encoder_load_ms",OpenVoiceBench.ms(start));start=System.nanoTime();
        source=encode(env,encoder,spec,frames);target=encode(env,encoder,refSpec,refFrames);report.put("both_embeddings_ms",OpenVoiceBench.ms(start));
      }
      raw(new File(out,"source.f32"),source);raw(new File(out,"target.f32"),target);
      Random random=new Random(123);float[] noise=new float[192*frames];for(int i=0;i<noise.length;i++)noise[i]=(float)random.nextGaussian();
      float[] tau={.3f};raw(new File(out,"noise.f32"),noise);raw(new File(out,"tau.f32"),tau);
      ByteBuffer lengths=ByteBuffer.allocateDirect(8).order(ByteOrder.nativeOrder());lengths.asLongBuffer().put(frames);
      ByteBuffer stored=ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(frames);Files.write(new File(out,"lengths.i64").toPath(),stored.array());
      Map<String,OnnxTensor> inputs=new LinkedHashMap<>();
      inputs.put("spec",tensor(env,spec,1,513,frames));inputs.put("lengths",OnnxTensor.createTensor(env,lengths.asLongBuffer(),new long[]{1}));
      inputs.put("source",tensor(env,source,1,256,1));inputs.put("target",tensor(env,target,1,256,1));inputs.put("noise",tensor(env,noise,1,192,frames));inputs.put("tau",tensor(env,tau,1));
      JSONObject manifest=new JSONObject();manifest.put("model","../tone_converter.onnx");manifest.put("inputs",new JSONObject());manifest.put("output","android-output.f32");manifest.put("runs",3);
      input(manifest,"spec","spec.f32","float32",1,513,frames);input(manifest,"lengths","lengths.i64","int64",1);
      input(manifest,"source","source.f32","float32",1,256,1);input(manifest,"target","target.f32","float32",1,256,1);input(manifest,"noise","noise.f32","float32",1,192,frames);input(manifest,"tau","tau.f32","float32",1);
      Files.write(new File(out,"manifest.json").toPath(),manifest.toString(2).getBytes("UTF-8"));
      start=System.nanoTime();
      try(OrtSession converter=env.createSession(new File(root,"tone_converter.onnx").getPath(),options)){
        report.put("converter_load_ms",OpenVoiceBench.ms(start));JSONArray runs=new JSONArray();
        for(int run=0;run<3;run++){
          start=System.nanoTime();
          try(OrtSession.Result result=converter.run(inputs)){
            double elapsed=OpenVoiceBench.ms(start);float[] audio=flatten((OnnxTensor)result.get(0));
            double peak=0,energy=0;for(float v:audio){if(!Float.isFinite(v))throw new IllegalStateException("Nonfinite output");peak=Math.max(peak,Math.abs(v));energy+=(double)v*v;}
            JSONObject r=new JSONObject();r.put("run",run);r.put("inference_ms",elapsed);r.put("samples",audio.length);r.put("peak",peak);r.put("rms",Math.sqrt(energy/audio.length));r.put("memory",OpenVoiceBench.memory());runs.put(r);
            if(run==2){raw(new File(out,"android-output.f32"),audio);Files.write(new File(out,"converted.wav").toPath(),AudioFrontend.wav(audio));}
          }
        }
        report.put("runs",runs);
      }finally{for(OnnxTensor t:inputs.values())t.close();}
    }
    report.put("memory_final",OpenVoiceBench.memory());System.out.println(report.toString());Files.write(new File(out,"metrics.json").toPath(),report.toString(2).getBytes("UTF-8"));
  }
}

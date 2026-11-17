package app.nyvemi.openvoice;

import ai.onnxruntime.*;
import java.io.File;
import java.nio.*;
import java.util.*;
import java.util.concurrent.CancellationException;
import java.util.concurrent.atomic.AtomicLong;

/** Reusable CPU converter. Inputs are mono PCM at 22050 Hz; no networking or watermark stage. */
public final class OpenVoicePipeline implements AutoCloseable {
  private final OrtEnvironment env;
  private final OrtSession encoder, converter;
  private final Object runLock=new Object();
  private final AtomicLong generation=new AtomicLong();
  private OrtSession.RunOptions active;
  private boolean closed;
  public OpenVoicePipeline(File encoderFile,File converterFile)throws OrtException {
    env=OrtEnvironment.getEnvironment();env.setTelemetry(false);
    try(OrtSession.SessionOptions opts=new OrtSession.SessionOptions()){
      opts.setIntraOpNumThreads(4);opts.setInterOpNumThreads(1);
      opts.setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL);
      opts.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
      encoder=env.createSession(encoderFile.getAbsolutePath(),opts);
      try{converter=env.createSession(converterFile.getAbsolutePath(),opts);}catch(OrtException|RuntimeException e){encoder.close();throw e;}
    }
  }
  private void check(long epoch){if(generation.get()!=epoch||Thread.currentThread().isInterrupted())throw new CancellationException("Voice conversion canceled");}
  private OnnxTensor tensor(float[] data,long...shape)throws OrtException{
    ByteBuffer bytes=ByteBuffer.allocateDirect(data.length*4).order(ByteOrder.nativeOrder());bytes.asFloatBuffer().put(data);
    return OnnxTensor.createTensor(env,bytes.asFloatBuffer(),shape);
  }
  private float[] output(OrtSession session,Map<String,OnnxTensor> inputs,OrtSession.RunOptions options)throws OrtException{
    try(OrtSession.Result result=session.run(inputs,options)){
      FloatBuffer b=((OnnxTensor)result.get(0)).getFloatBuffer();float[] values=new float[b.remaining()];b.get(values);
      for(float v:values)if(!Float.isFinite(v))throw new IllegalStateException("Nonfinite local voice output");
      return values;
    }
  }
  private float[] embedding(AudioFrontend.Spectrum spec,OrtSession.RunOptions options)throws OrtException{
    try(OnnxTensor input=tensor(spec.timeMajor(),1,spec.frames,513)){return output(encoder,Collections.singletonMap("spec",input),options);}
  }
  public synchronized float[] convert(float[] source22050,float[] reference22050,long seed)throws OrtException {
    if(closed)throw new IllegalStateException("Local voice converter closed");
    if(source22050.length<1024||source22050.length>220500||reference22050.length<1024||reference22050.length>661500)throw new IllegalArgumentException("Source must be <=10s and reference <=30s, with at least 1024 samples");
    final long epoch=generation.get();Map<String,OnnxTensor> inputs=new LinkedHashMap<>();
    OrtSession.RunOptions options=new OrtSession.RunOptions();
    synchronized(runLock){active=options;}
    try{
      check(epoch);AudioFrontend.Spectrum spec=AudioFrontend.spectrogram(source22050);check(epoch);
      AudioFrontend.Spectrum ref=AudioFrontend.spectrogram(reference22050);check(epoch);
      float[] source=embedding(spec,options);check(epoch);float[] target=embedding(ref,options);check(epoch);
      Random random=new Random(seed);float[] noise=new float[192*spec.frames];for(int i=0;i<noise.length;i++)noise[i]=(float)random.nextGaussian();
      inputs.put("spec",tensor(spec.frequencyMajor,1,513,spec.frames));
      ByteBuffer lengths=ByteBuffer.allocateDirect(8).order(ByteOrder.nativeOrder());lengths.asLongBuffer().put(spec.frames);
      inputs.put("lengths",OnnxTensor.createTensor(env,lengths.asLongBuffer(),new long[]{1}));
      inputs.put("source",tensor(source,1,256,1));inputs.put("target",tensor(target,1,256,1));inputs.put("noise",tensor(noise,1,192,spec.frames));inputs.put("tau",tensor(new float[]{.3f},1));
      check(epoch);float[] result=output(converter,inputs,options);check(epoch);return result;
    }finally{
      synchronized(runLock){active=null;options.close();}
      for(OnnxTensor input:inputs.values())input.close();
    }
  }
  public void cancel(){
    generation.incrementAndGet();
    synchronized(runLock){if(active!=null)try{active.setTerminate(true);}catch(OrtException ignored){/* Generation check still prevents publishing canceled audio. */}}
  }
  @Override public void close()throws OrtException {
    cancel();synchronized(this){if(closed)return;closed=true;try{converter.close();}finally{encoder.close();}}
  }
}

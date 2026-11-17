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
  /** Pure segmentation contract: contiguous complete coverage, no chunk exceeds ten seconds. */
  public static int[] segmentEnds(float[] source) {
    if(source.length<1024||source.length>661500)throw new IllegalArgumentException("Source must be 1024 samples to 30 seconds");
    for(float value:source)if(!Float.isFinite(value))throw new IllegalArgumentException("Nonfinite source audio");
    ArrayList<Integer> ends=new ArrayList<>();int start=0;
    while(source.length-start>220500){
      int center=start+176400,lo=center-11025,hi=Math.min(center+11025,source.length-1024);
      // Search a 1-second region around eight seconds for the quietest 20ms window.
      int half=220,best=center;double energy=0,bestEnergy=Double.POSITIVE_INFINITY;
      for(int i=lo-half;i<=lo+half;i++)energy+=(double)source[i]*source[i];
      for(int candidate=lo;candidate<=hi;candidate++){
        if(energy<bestEnergy-1e-15||(Math.abs(energy-bestEnergy)<=1e-15&&Math.abs(candidate-center)<Math.abs(best-center))){bestEnergy=energy;best=candidate;}
        if(candidate<hi){energy-=(double)source[candidate-half]*source[candidate-half];energy+=(double)source[candidate+half+1]*source[candidate+half+1];}
      }
      ends.add(best);start=best;
    }
    ends.add(source.length);int[] result=new int[ends.size()];for(int i=0;i<result.length;i++)result[i]=ends.get(i);return result;
  }
  /** Convert every segment locally; never substitute unconverted source audio. */
  public synchronized float[] convertLong(float[] source22050,float[] reference22050,long seed)throws OrtException {
    if(closed)throw new IllegalStateException("Local voice converter closed");
    final long epoch=generation.get();check(epoch);int[] ends=segmentEnds(source22050);check(epoch);
    if(reference22050.length<1024||reference22050.length>661500)throw new IllegalArgumentException("Reference must be 1024 samples to 30 seconds");
    if(ends.length==1)return convertSegment(source22050,reference22050,seed,epoch);
    ArrayList<float[]> chunks=new ArrayList<>();int start=0,total=0;
    for(int i=0;i<ends.length;i++){
      check(epoch);float[] chunk=Arrays.copyOfRange(source22050,start,ends[i]);
      float[] converted=convertSegment(chunk,reference22050,seed+i,epoch);check(epoch);
      chunks.add(converted);total=Math.addExact(total,converted.length);start=ends[i];
    }
    float[] result=new float[total];int offset=0;
    for(float[] chunk:chunks){check(epoch);System.arraycopy(chunk,0,result,offset,chunk.length);offset+=chunk.length;}
    check(epoch);return result;
  }
  public synchronized float[] convert(float[] source22050,float[] reference22050,long seed)throws OrtException {
    return convertSegment(source22050,reference22050,seed,generation.get());
  }
  private float[] convertSegment(float[] source22050,float[] reference22050,long seed,long epoch)throws OrtException {
    if(closed)throw new IllegalStateException("Local voice converter closed");
    if(source22050.length<1024||source22050.length>220500||reference22050.length<1024||reference22050.length>661500)throw new IllegalArgumentException("Source must be <=10s and reference <=30s, with at least 1024 samples");
    check(epoch);Map<String,OnnxTensor> inputs=new LinkedHashMap<>();
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

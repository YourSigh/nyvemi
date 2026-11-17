import app.nyvemi.openvoice.*;
import java.io.*;
import java.nio.*;
import java.nio.file.*;
import java.util.concurrent.atomic.AtomicReference;
import org.json.*;

/** Device-only regression: cancel ongoing work, reuse session, compare full CLI output. */
public final class PipelineAcceptance {
 public static void segmentationTests(){
  for(int length:new int[]{1024,220500,220501,441000,661500}){
   float[] source=new float[length];java.util.Arrays.fill(source,.1f);int[] ends=OpenVoicePipeline.segmentEnds(source);int start=0;
   for(int end:ends){if(end-start<1024||end-start>220500)throw new AssertionError("Segment bounds");start=end;}
   if(start!=length)throw new AssertionError("Incomplete coverage");
   if(length<=220500&&ends.length!=1)throw new AssertionError("Short audio changed");
  }
  float[] quiet=new float[441000];java.util.Arrays.fill(quiet,.5f);java.util.Arrays.fill(quiet,170000,171000,0f);
  int first=OpenVoicePipeline.segmentEnds(quiet)[0];if(first<170220||first>170780)throw new AssertionError("Quiet boundary not selected");
  for(int bad:new int[]{0,1023,661501}){try{OpenVoicePipeline.segmentEnds(new float[bad]);throw new AssertionError("Expected bound rejection");}catch(IllegalArgumentException expected){}}
  float[] nonfinite=new float[1024];nonfinite[0]=Float.NaN;try{OpenVoicePipeline.segmentEnds(nonfinite);throw new AssertionError("NaN accepted");}catch(IllegalArgumentException expected){}
  System.out.println("PASS segmentation bounds, quiet boundary, complete coverage, and invalid input");
 }
 public static void main(String[] args)throws Exception{
  segmentationTests();if(args.length==0)return;
  File root=new File(args[0]);
  AudioFrontend.Audio s=AudioFrontend.readWav(Files.readAllBytes(new File(root,"source.wav").toPath()));
  AudioFrontend.Audio r=AudioFrontend.readWav(Files.readAllBytes(new File(root,"reference.wav").toPath()));
  float[] source=AudioFrontend.resample(s.samples,s.rate),reference=AudioFrontend.resample(r.samples,r.rate);
  OpenVoicePipeline p=new OpenVoicePipeline(new File(root,"tone_encoder.onnx"),new File(root,"tone_converter.onnx"));
  AtomicReference<Throwable> failure=new AtomicReference<>();
  Thread task=new Thread(()->{try{p.convert(source,reference,123);}catch(Throwable e){failure.set(e);}});
  task.start();Thread.sleep(350);long start=System.nanoTime();p.cancel();task.join(5000);
  if(task.isAlive()||failure.get()==null)throw new AssertionError("Cancellation did not interrupt active conversion");
  JSONObject report=new JSONObject();report.put("cancel_ms",OpenVoiceBench.ms(start));report.put("cancel_exception",failure.get().getClass().getSimpleName());
  start=System.nanoTime();float[] out=p.convert(source,reference,123);report.put("reuse_ms",OpenVoiceBench.ms(start));
  FloatBuffer expected=ByteBuffer.wrap(Files.readAllBytes(new File(root,"wav-case/android-output.f32").toPath())).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer();
  if(expected.remaining()!=out.length)throw new AssertionError("Output length");
  double max=0;for(float v:out)max=Math.max(max,Math.abs(v-expected.get()));if(max>1e-5)throw new AssertionError("Pipeline mismatch "+max);
  report.put("max_abs_vs_cli",max);report.put("samples",out.length);report.put("memory",OpenVoiceBench.memory());
  p.close();p.close();boolean rejects=false;try{p.convert(source,reference,123);}catch(IllegalStateException e){rejects=true;}if(!rejects)throw new AssertionError("Closed pipeline still works");
  report.put("closed_rejected",true);System.out.println(report.toString());
 }
}

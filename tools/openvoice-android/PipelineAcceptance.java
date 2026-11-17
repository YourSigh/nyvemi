import app.nyvemi.openvoice.*;
import java.io.*;
import java.nio.*;
import java.nio.file.*;
import java.util.concurrent.atomic.AtomicReference;
import org.json.*;

/** Device-only regression: cancel ongoing work, reuse session, compare full CLI output. */
public final class PipelineAcceptance {
 public static void main(String[] args)throws Exception{
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

import ai.onnxruntime.*;
import org.json.*;
import java.io.*;
import java.nio.*;
import java.nio.file.*;
import java.util.*;

/** Offline CPU-only model benchmark. Raw tensor files use little-endian ordering. */
public final class OpenVoiceBench {
  static double ms(long start) { return (System.nanoTime()-start)/1e6; }
  static JSONObject memory() throws Exception {
    JSONObject m = new JSONObject();
    for (String line : Files.readAllLines(Paths.get("/proc/self/status"))) {
      if (line.startsWith("VmRSS:") || line.startsWith("VmHWM:")) {
        String[] a=line.trim().split("\\s+"); m.put(a[0].replace(":",""),Long.parseLong(a[1]));
      }
    }
    return m;
  }
  public static void main(String[] args) throws Exception {
    if(args.length != 1) throw new IllegalArgumentException("Expected one manifest path");
    File manifest = new File(args[0]).getCanonicalFile(); File dir=manifest.getParentFile();
    JSONObject config=new JSONObject(new String(Files.readAllBytes(manifest.toPath()),"UTF-8"));
    long start=System.nanoTime();
    OrtEnvironment env=OrtEnvironment.getEnvironment(); env.setTelemetry(false);
    JSONObject report=new JSONObject();
    report.put("ort",env.getVersion()); report.put("arch",System.getProperty("os.arch"));
    report.put("providers",OrtEnvironment.getAvailableProviders().toString());
    report.put("environment_ms",ms(start));
    Map<String,OnnxTensor> inputs=new LinkedHashMap<>();
    try (OrtSession.SessionOptions options=new OrtSession.SessionOptions()) {
      int threads=config.optInt("threads",4); options.setIntraOpNumThreads(threads); options.setInterOpNumThreads(1);
      options.setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL);
      options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
      report.put("threads",threads); report.put("memory_before",memory());
      start=System.nanoTime();
      try (OrtSession session=env.createSession(new File(dir,config.getString("model")).getPath(),options)) {
        report.put("model_load_ms",ms(start)); report.put("memory_loaded",memory());
        JSONArray defs=new JSONArray();
        Object inputDefs=config.get("inputs");
        if(inputDefs instanceof JSONArray) defs=(JSONArray)inputDefs;
        else {JSONObject obj=(JSONObject)inputDefs; Iterator<String> keys=obj.keys();
          while(keys.hasNext()){String key=keys.next();JSONObject value=obj.getJSONObject(key);value.put("name",key);defs.put(value);}}
        for(int i=0;i<defs.length();i++) {
          JSONObject def=defs.getJSONObject(i); JSONArray dims=def.getJSONArray("shape");
          long[] shape=new long[dims.length()]; long elements=1;
          for(int j=0;j<shape.length;j++){shape[j]=dims.getLong(j);elements=Math.multiplyExact(elements,shape[j]);}
          byte[] raw=Files.readAllBytes(new File(dir,def.getString("file")).toPath());
          String dtype=def.getString("dtype"); int size=dtype.equals("float32")?4:dtype.equals("int64")?8:0;
          if(size==0 || elements*size!=raw.length)throw new IllegalArgumentException("Invalid tensor "+def.getString("name"));
          ByteBuffer b=ByteBuffer.allocateDirect(raw.length).order(ByteOrder.LITTLE_ENDIAN); b.put(raw); b.rewind();
          OnnxTensor t=size==4?OnnxTensor.createTensor(env,b.asFloatBuffer(),shape):OnnxTensor.createTensor(env,b.asLongBuffer(),shape);
          inputs.put(def.getString("name"),t);
        }
        JSONArray runs=new JSONArray(); int count=config.optInt("runs",2);
        if(count<1||count>20)throw new IllegalArgumentException("runs must be 1..20");
        for(int i=0;i<count;i++) {
          start=System.nanoTime();
          try(OrtSession.Result result=session.run(inputs)) {
            double elapsed=ms(start); OnnxTensor output=(OnnxTensor)result.get(0);
            FloatBuffer f=output.getFloatBuffer(); int n=f.remaining();
            ByteBuffer out=ByteBuffer.allocate(n*4).order(ByteOrder.LITTLE_ENDIAN);
            double energy=0, peak=0; int nonfinite=0;
            while(f.hasRemaining()){float v=f.get(); if(!Float.isFinite(v))nonfinite++;else {energy+=(double)v*v;peak=Math.max(peak,Math.abs(v));}out.putFloat(v);}
            JSONObject run=new JSONObject();run.put("run",i);run.put("inference_ms",elapsed);run.put("elements",n);
            run.put("shape",new JSONArray(output.getInfo().getShape()));run.put("nonfinite",nonfinite);
            run.put("rms",Math.sqrt(energy/Math.max(n,1)));run.put("peak",peak);run.put("memory",memory());
            runs.put(run);
            if(i==count-1)Files.write(new File(dir,config.getString("output")).toPath(),out.array());
            if(nonfinite!=0)throw new IllegalStateException("Nonfinite output");
          }
        }
        report.put("runs",runs);
      }
    } finally { for(OnnxTensor t:inputs.values())t.close(); }
    report.put("memory_final",memory());
    System.out.println(report.toString());
    Files.write(new File(dir,config.getString("output")+".metrics.json").toPath(),report.toString(2).getBytes("UTF-8"));
  }
}

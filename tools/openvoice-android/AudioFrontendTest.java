package app.nyvemi.openvoice;

import java.io.*;
import java.nio.*;
import java.nio.file.*;
public final class AudioFrontendTest {
  static void require(boolean x){if(!x)throw new AssertionError();}
  static void write(String path,float[] x)throws Exception {
    ByteBuffer b=ByteBuffer.allocate(x.length*4).order(ByteOrder.LITTLE_ENDIAN);for(float v:x)b.putFloat(v);Files.write(Paths.get(path),b.array());
  }
  interface Attempt { void run(); }
  static void rejects(Attempt f){try{f.run();throw new AssertionError("Expected rejection");}catch(IllegalArgumentException expected){}}
  static void edgeTests() {
    float[] tone=new float[22050];for(int i=0;i<tone.length;i++)tone[i]=(float)(.1*Math.sin(i*.1));
    byte[] mono=AudioFrontend.wav(tone);
    ByteBuffer stereo=ByteBuffer.allocate(44+tone.length*4).order(ByteOrder.LITTLE_ENDIAN);
    stereo.put(mono,0,44);stereo.putInt(4,36+tone.length*4);stereo.putShort(22,(short)2);stereo.putInt(28,88200);stereo.putShort(32,(short)4);stereo.putInt(40,tone.length*4);
    for(int i=0;i<tone.length;i++){stereo.putShort((short)1000);stereo.putShort((short)-1000);}
    for(float f:AudioFrontend.readWav(stereo.array()).samples)require(f==0);
    byte[] bad=mono.clone();bad[20]=3;rejects(()->AudioFrontend.readWav(bad));
    rejects(()->AudioFrontend.readWav(java.util.Arrays.copyOf(mono,mono.length-1)));
    rejects(()->AudioFrontend.resample(new float[48000*30+1],48000));
    rejects(()->AudioFrontend.resample(new float[1024],7999));
    rejects(()->AudioFrontend.resample(new float[1024],96001));
    for(int rate:new int[]{8000,11025,12000,12345,32000,88200,96000}){
      float[] sample=new float[1024];java.util.Arrays.fill(sample,.1f);
      float[] converted=AudioFrontend.resample(sample,rate);require(converted.length==(int)Math.ceil(1024.0*22050/rate));
      for(float value:converted)require(Float.isFinite(value));
      byte[] atRate=AudioFrontend.wav(sample);ByteBuffer header=ByteBuffer.wrap(atRate).order(ByteOrder.LITTLE_ENDIAN);header.putInt(24,rate);header.putInt(28,rate*2);
      require(AudioFrontend.readWav(atRate).rate==rate);
    }
    for(int rate:new int[]{7999,96001}){byte[] badRate=mono.clone();ByteBuffer header=ByteBuffer.wrap(badRate).order(ByteOrder.LITTLE_ENDIAN);header.putInt(24,rate);header.putInt(28,rate*2);rejects(()->AudioFrontend.readWav(badRate));}
    rejects(()->AudioFrontend.spectrogram(new float[384]));
    rejects(()->AudioFrontend.wav(new float[]{Float.NaN}));
    float[] high=new float[48000];for(int i=0;i<high.length;i++)high[i]=(float)Math.sin(2*Math.PI*15000*i/48000);
    float[] down=AudioFrontend.resample(high,48000);double sum=0;for(int i=500;i<down.length-500;i++)sum+=down[i]*down[i];
    require(Math.sqrt(sum/(down.length-1000))<.001); // > 56 dB rejection above output Nyquist.
    float[] dc=new float[16000];java.util.Arrays.fill(dc,.25f);float[] up=AudioFrontend.resample(dc,16000);
    for(int i=500;i<up.length-500;i++)require(Math.abs(up[i]-.25)<.00001);
  }
  public static void main(String[] args)throws Exception {
    edgeTests();
    if(args.length==0){System.out.println("PASS frontend rate bounds and format edge cases");return;}
    int sr=Integer.parseInt(args[1]);byte[] data=Files.readAllBytes(Paths.get(args[0]));
    ByteBuffer b=ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);float[] input=new float[data.length/2];for(int i=0;i<input.length;i++)input[i]=b.getShort()/32768f;
    float[] y=AudioFrontend.resample(input,sr);AudioFrontend.Spectrum s=AudioFrontend.spectrogram(y);
    write(args[2]+".resampled.f32",y);write(args[2]+".spec.f32",s.frequencyMajor);write(args[2]+".transpose.f32",s.timeMajor());
    byte[] wav=AudioFrontend.wav(y);AudioFrontend.Audio parsed=AudioFrontend.readWav(wav);require(parsed.rate==22050&&parsed.samples.length==y.length);
    for(int i=0;i<y.length;i++)require(Math.abs(parsed.samples[i]-Math.max(-1,Math.min(32767/32768.,y[i])))<=1./32768);
    byte[] bad=wav.clone();bad[20]=3;try{AudioFrontend.readWav(bad);throw new AssertionError();}catch(IllegalArgumentException expected){}
    try{AudioFrontend.spectrogram(new float[384]);throw new AssertionError();}catch(IllegalArgumentException expected){}
    try{AudioFrontend.wav(new float[]{Float.NaN});throw new AssertionError();}catch(IllegalArgumentException expected){}
    require(s.frames==y.length/256);System.out.println("PASS samples="+y.length+" frames="+s.frames);
  }
}

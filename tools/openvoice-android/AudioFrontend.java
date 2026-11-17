package app.nyvemi.openvoice;

import java.io.*;
import java.nio.*;

/** Dependency-free Android-compatible converter frontend. No network or model loading.
 * STFT matches OpenVoice's linear spectrogram contract. Resampling uses our own
 * 64-lobe Hann-windowed sinc, NOT bit-identical to librosa's soxr_hq.
 */
public final class AudioFrontend {
  public static final int RATE=22050, FFT=1024, HOP=256, BINS=513;
  private static final int MAX_BYTES=6*1024*1024;
  public static final class Audio {
    public final float[] samples; public final int rate;
    Audio(float[] samples,int rate) { this.samples=samples; this.rate=rate; }
  }
  public static final class Spectrum {
    public final float[] frequencyMajor; public final int frames;
    Spectrum(float[] values,int frames) {this.frequencyMajor=values;this.frames=frames;}
    public float[] timeMajor() {
      float[] x=new float[frequencyMajor.length];
      for(int f=0;f<BINS;f++) for(int t=0;t<frames;t++) x[t*BINS+f]=frequencyMajor[f*frames+t];
      return x;
    }
  }
  private static int u16(byte[] b,int i) {return (b[i]&255)|((b[i+1]&255)<<8);}
  private static long u32(byte[] b,int i) {return ((long)u16(b,i))|((long)u16(b,i+2)<<16);}
  private static boolean tag(byte[] b,int i,String s) {
    for(int k=0;k<4;k++)if(b[i+k]!=(byte)s.charAt(k))return false;return true;
  }
  private static boolean supported(int rate) {return rate>=8000&&rate<=96000;}
  public static Audio readWav(byte[] b) {
    if(b.length<44||b.length>MAX_BYTES||!tag(b,0,"RIFF")||!tag(b,8,"WAVE")||u32(b,4)+8!=b.length)
      throw new IllegalArgumentException("Invalid or oversized RIFF WAV");
    int channels=0,rate=0,alignment=0,offset=-1,size=0;
    for(int p=12;p+8<=b.length;) {
      long n=u32(b,p+4);long end=(long)p+8+n;
      if(end>b.length)throw new IllegalArgumentException("Truncated WAV chunk");
      if(tag(b,p,"fmt ")) {
        if(channels!=0||n<16||u16(b,p+8)!=1||u16(b,p+22)!=16)throw new IllegalArgumentException("Only PCM16 WAV supported");
        channels=u16(b,p+10);rate=(int)u32(b,p+12);alignment=u16(b,p+20);
        if((channels!=1&&channels!=2)||!supported(rate)||alignment!=channels*2||u32(b,p+16)!=(long)rate*alignment)
          throw new IllegalArgumentException("Unsupported WAV format");
      } else if(tag(b,p,"data")) {
        if(offset>=0)throw new IllegalArgumentException("Duplicate WAV data");offset=p+8;size=(int)n;
      }
      p=(int)(end+(n&1));
      if(p>b.length)throw new IllegalArgumentException("Missing chunk padding");
    }
    if(channels==0||offset<0||size==0||size%alignment!=0||size/alignment>rate*30)
      throw new IllegalArgumentException("WAV must contain 0–30 seconds PCM16");
    float[] out=new float[size/alignment];
    for(int i=0;i<out.length;i++) {
      double sum=0;
      for(int c=0;c<channels;c++)sum+=(short)u16(b,offset+i*alignment+c*2)/32768.0;
      out[i]=(float)(sum/channels);
    }
    return new Audio(out,rate);
  }
  private static void validate(float[] in,int rate) {
    if(!supported(rate)||in.length==0||in.length>rate*30)throw new IllegalArgumentException("Audio duration or rate unsupported");
    for(float x:in)if(!Float.isFinite(x))throw new IllegalArgumentException("Nonfinite audio");
  }
  public static float[] resample(float[] in,int from) {
    validate(in,from);if(from==RATE)return in.clone();
    int count=(int)Math.ceil((double)in.length*RATE/from);
    float[] out=new float[count];
    double cutoff=Math.min(1.,(double)RATE/from)*.94;
    double radius=64./cutoff;
    for(int i=0;i<count;i++) {
      double position=(double)i*from/RATE,sum=0,weight=0;
      int start=(int)Math.ceil(position-radius),end=(int)Math.floor(position+radius);
      for(int j=start;j<=end;j++) {
        double d=position-j,phase=Math.PI*d*cutoff;
        double sinc=Math.abs(phase)<1e-12?1.:Math.sin(phase)/phase;
        double w=cutoff*sinc*(.5+.5*Math.cos(Math.PI*d/radius));
        weight+=w;if(j>=0&&j<in.length)sum+=in[j]*w;
      }
      out[i]=(float)(sum/weight);
    }
    return out;
  }
  private static int reflect(int i,int n) {
    while(i<0||i>=n)i=i<0?-i:2*n-2-i;return i;
  }
  /** [1,513,T], T=floor(N/256), equivalent reflect(384), periodic Hann. */
  public static Spectrum spectrogram(float[] samples) {
    validate(samples,RATE);
    if(samples.length<=384)throw new IllegalArgumentException("STFT requires more than 384 samples");
    int frames=(samples.length+768-FFT)/HOP+1;
    float[] out=new float[BINS*frames]; double[] window=new double[FFT];
    for(int j=0;j<FFT;j++)window[j]=.5-.5*Math.cos(2*Math.PI*j/FFT);
    for(int frame=0;frame<frames;frame++) {
      double[] re=new double[FFT],im=new double[FFT];
      for(int j=0;j<FFT;j++)re[j]=samples[reflect(frame*HOP+j-384,samples.length)]*window[j];
      fft(re,im);
      for(int f=0;f<BINS;f++)out[f*frames+frame]=(float)Math.sqrt(re[f]*re[f]+im[f]*im[f]+1e-6);
    }
    return new Spectrum(out,frames);
  }
  private static void fft(double[] re,double[] im) {
    for(int i=1,j=0;i<FFT;i++) {
      int bit=FFT>>1;for(; (j&bit)!=0;bit>>=1)j^=bit;j^=bit;
      if(i<j){double r=re[i];re[i]=re[j];re[j]=r;}
    }
    for(int length=2;length<=FFT;length<<=1) {
      double angle=-2*Math.PI/length,wr=Math.cos(angle),wi=Math.sin(angle);
      for(int i=0;i<FFT;i+=length) {
        double ur=1,ui=0;
        for(int j=0;j<length/2;j++) {
          int x=i+j,y=x+length/2;double vr=re[y]*ur-im[y]*ui,vi=re[y]*ui+im[y]*ur;
          re[y]=re[x]-vr;im[y]=im[x]-vi;re[x]+=vr;im[x]+=vi;
          double next=ur*wr-ui*wi;ui=ur*wi+ui*wr;ur=next;
        }
      }
    }
  }
  public static byte[] wav(float[] samples) {
    validate(samples,RATE); ByteBuffer b=ByteBuffer.allocate(44+samples.length*2).order(ByteOrder.LITTLE_ENDIAN);
    b.put(new byte[]{'R','I','F','F'}).putInt(36+samples.length*2).put(new byte[]{'W','A','V','E','f','m','t',' '});
    b.putInt(16).putShort((short)1).putShort((short)1).putInt(RATE).putInt(RATE*2).putShort((short)2).putShort((short)16);
    b.put(new byte[]{'d','a','t','a'}).putInt(samples.length*2);
    for(float f:samples)b.putShort((short)Math.max(-32768,Math.min(32767,Math.round(f*32768.))));
    return b.array();
  }
}

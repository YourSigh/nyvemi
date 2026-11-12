#include <jni.h>
#include <android/log.h>

#include <algorithm>
#include <cmath>
#include <memory>
#include <stdexcept>
#include <string>

#include "ggml-cpu.h"
#include "qwen3-tts/synthesizer.h"

namespace {
struct Engine {
    std::unique_ptr<ggml_backend, decltype(&ggml_backend_free)> backend{ggml_backend_cpu_init(), ggml_backend_free};
    std::unique_ptr<Synthesizer> model;

    Engine(const std::string & path, uint64_t offset, uint64_t length) {
        if (!backend) throw std::runtime_error("CPU backend unavailable");
        ggml_backend_cpu_set_n_threads(backend.get(), 4);
        model = std::make_unique<Synthesizer>(path, backend.get(), offset, length);
        if (model->sample_rate() != 24000 || model->ids().voices.size() != 9)
            throw std::runtime_error("Unexpected voice pack");
    }
};

std::string utf8(JNIEnv * env, jbyteArray data) {
    std::string value(env->GetArrayLength(data), '\0');
    env->GetByteArrayRegion(data, 0, value.size(), reinterpret_cast<jbyte *>(value.data()));
    return value;
}

void report(JNIEnv * env, const char * code) {
    __android_log_write(ANDROID_LOG_WARN, "NyvemiQwen", code);
    if (!env->ExceptionCheck()) env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), code);
}
} // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_app_nyvemi_nativebridge_NyvemiQwenNative_load(JNIEnv * env, jobject, jbyteArray path, jlong offset, jlong length) {
    try {
        return reinterpret_cast<jlong>(new Engine(utf8(env, path), offset, length));
    } catch (const std::exception &) {
        report(env, "qwen_load_failed");
        return 0;
    }
}

extern "C" JNIEXPORT void JNICALL
Java_app_nyvemi_nativebridge_NyvemiQwenNative_release(JNIEnv *, jobject, jlong handle) {
    delete reinterpret_cast<Engine *>(handle);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_app_nyvemi_nativebridge_NyvemiQwenNative_generate(JNIEnv * env, jobject, jlong handle, jbyteArray text,
                                                       jbyteArray voice, jobject receiver, jlong seed) {
    try {
        auto & model = *reinterpret_cast<Engine *>(handle)->model;
        const jmethodID pcm = env->GetMethodID(env->GetObjectClass(receiver), "onPcm", "([S)Z");
        if (!pcm) return JNI_FALSE;
        SynthesisRequest request;
        request.text = utf8(env, text);
        request.speaker = utf8(env, voice);
        request.seed = seed;
        // A short bubble should not produce minutes of audio if the sampler fails to end.
        request.max_frames = std::clamp<int>(request.text.size() * 3, 150, 800);
        bool sent = false;
        bool keepGoing = true;
        std::vector<jshort> converted;
        model.synthesize(request, [&](const float * samples, size_t count) {
            converted.resize(count);
            for (size_t i = 0; i < count; ++i) {
                const float sample = std::isfinite(samples[i]) ? samples[i] : 0.0f;
                converted[i] = std::lround(std::clamp(sample, -1.0f, 1.0f) * 32767.0f);
            }
            auto array = env->NewShortArray(count);
            if (!array) return keepGoing = false;
            env->SetShortArrayRegion(array, 0, count, converted.data());
            keepGoing = !env->ExceptionCheck() && env->CallBooleanMethod(receiver, pcm, array) == JNI_TRUE;
            env->DeleteLocalRef(array);
            sent = true;
            return keepGoing;
        });
        return sent && keepGoing;
    } catch (const std::exception &) {
        report(env, "qwen_synthesis_failed");
        return JNI_FALSE;
    }
}

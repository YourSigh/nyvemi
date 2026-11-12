cmake_minimum_required(VERSION 3.22)
project(nyvemi_qwen LANGUAGES C CXX)

add_subdirectory("${SPEECH_SOURCE}" speech EXCLUDE_FROM_ALL)
add_library(nyvemi_qwen SHARED qwen-jni.cpp)
target_compile_features(nyvemi_qwen PRIVATE cxx_std_17)
target_link_libraries(nyvemi_qwen PRIVATE qwen3tts log)
target_link_options(nyvemi_qwen PRIVATE "-Wl,-z,max-page-size=16384" "-Wl,--exclude-libs,ALL")

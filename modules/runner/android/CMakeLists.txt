cmake_minimum_required(VERSION 3.22)
project(runner_pty C)

# Builds libpty.so, loaded by Pty.kt.
add_library(pty SHARED src/main/cpp/pty.c)
target_compile_options(pty PRIVATE -Wall -O2)

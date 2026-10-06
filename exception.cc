#include <stdexcept>
#include <iostream>

#include <emscripten.h>

extern "C" void EMSCRIPTEN_KEEPALIVE what_to_stderr(intptr_t pointer)
{
  auto error = reinterpret_cast<std::runtime_error *>(pointer);
  std::cerr << error->what() << "\n";
}

int main()
{
  throw std::runtime_error("I want to see this in the console");
  return 0;
}
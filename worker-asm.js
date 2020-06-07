importScripts('./ffmpeg-all-codecs-new.js');

function print(text) {
  postMessage({
    'type' : 'stdout',
    'data' : text
  });
}

var now = Date.now

var wasm = null;

onmessage = function(event) {

  var message = event.data;

  if (message.type === "command") {

    var Module = {
      print: print,
      printErr: print,
      files: message.files || [],
      arguments: message.arguments || [],
      TOTAL_MEMORY: message.TOTAL_MEMORY || 268435456
      // Can play around with this option - must be a power of 2
      // TOTAL_MEMORY: 268435456
    };

    postMessage({
      'type' : 'start',
      'data' : Module.arguments.join(" ")
    });

    postMessage({
      'type' : 'stdout',
      'data' : 'Received command: ' +
                Module.arguments.join(" ") +
                ((Module.TOTAL_MEMORY) ? ".  Processing with " + Module.TOTAL_MEMORY + " bits." : "")
    });

    var time = now();

    Module['returnCallback'] = function(result) {
      var totalTime = now() - time;

      postMessage({
        'type' : 'stdout',
        'data' : 'Finished processing (took ' + totalTime + 'ms)'
      });

      postMessage({
        'type' : 'done',
        'data' : result,
        'time' : totalTime
      });
    }

    var result = ffmpeg_run(Module, wasm);

  }

};

fetch('ffmpeg-all-codecs.wasm').then(response =>
  response.arrayBuffer()
).then(bytes =>
  WebAssembly.compile(bytes)
).then(mod => {
  wasm = mod;
  postMessage({
    'type' : 'ready'
  });
});

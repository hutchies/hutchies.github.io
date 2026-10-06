importScripts('./ffmpeg-all-codecs-new.js');

function print(text) {
  postMessage({
    'type' : 'stdout',
    'data' : text
  });
}

function null_print(text){
  log_text += text+"\n";
}

var now = Date.now

var log_text = "";

var id = 0;
var running_in_parallel = false;

onmessage = function(event) {

  var message = event.data;

  if (message.type === "command") {

    id = message.id;
    wasm = message.wasm;

    if(id != -1) running_in_parallel = true;

    postMessage({
      'type' : 'num',
      'data' : message
    });

    var Module = {
      print: print,
      printErr: print,
      files: message.files || [],
      arguments: message.arguments || [],
      TOTAL_MEMORY: message.TOTAL_MEMORY || 268435456
      // Can play around with this option - must be a power of 2
      // TOTAL_MEMORY: 268435456
    };

    if(running_in_parallel){
      Module["print"] = null_print;
      Module["printErr"] = null_print;

      postMessage({
        'type' : 'thread_start',
        'id'   : id,
        'data' : Module.arguments.join(" ")
      });
    }else{
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
    }

    var time = now();

    if(running_in_parallel){
      Module['returnCallback'] = function(result) {
        var totalTime = now() - time;

        if(result){
          postMessage({
            'type' : 'thread_done',
            'id'   : id,
            'data' : result,
            'log'  : log_text,
            'time' : totalTime
          });
        }else{
          // I guess an error?
          postMessage({
            'type' : 'thread_err',
            'id'   : id,
            'data' : log_text,
            'time' : totalTime
          });
        }
      }
    }else{
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
    }

    var result = ffmpeg_run(Module, wasm);

  }

};

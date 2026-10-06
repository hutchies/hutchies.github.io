function send_message(payload, worker){
  const msg_id = window.message_id++;
  const msg = {
    id: msg_id,
    payload
  }

  return new Promise(function(resolve, reject) {
    window.worker_resolves[msg_id] = resolve
    window.worker_rejects[msg_id] = worker_reject

    worker.postMessage(msg);
  });
}

function handle_message(msg){
  const {id, err, payload} = msg.data;
  if (payload) {
    const resolve = window.worker_resolves[id]
    if (resolve) {
      resolve(payload)
    }
  } else {
    // error condition
    const reject = window.worker_rejects[id]
    if (reject) {
        if (err) {
          reject(err)
        } else {
          reject('Got nothing')
        }
    }
  }

  // purge used callbacks
  delete window.worker_resolves[id]
  delete window.worker_rejects[id]
}

class Wrapper {
  constructor() {
    this.worker = new Worker('./worker.js')
    this.worker.onmessage = handleMsg
  }

  oche(str) {
    return sendMsg(str, this.worker)
  }
}

export default Wrapper

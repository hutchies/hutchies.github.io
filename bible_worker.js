onmessage = function(event){
  var message = event.data;

  if (message.type === "lookup") {
    var passage = message.passage;
    var version = message.version;
    var url = "https://www.biblegateway.com/passage/?search="+encodeURIComponent(passage)+'&version='+encodeURIComponent(version);

    fetch(url, {method: 'get', mode: 'no-cors'})
      .then(function(response){
        if(response.type == 'basic') return response.text();
        else postMessage({
          'type' : 'error',
          'data' : response,
        })
      })
      .then(function(text){
        postMessage({
          'type' : 'found',
          'data' : text,
          'passage': passage
        })
      });
    }
}

postMessage({
  'type' : 'ready'
});

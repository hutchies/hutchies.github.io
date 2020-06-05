onmessage = function(event){
  var message = event.data;

  if (message.type === "lookup") {
    var passage = message.passage;
    var version = message.version;
    var url = "https://www.biblegateway.com/passage/?search="+encodeURIComponent(passage)+'&version='+encodeURIComponent(version);

    fetch(url, {method: 'get', mode: 'no-cors'})
      .then(function(response){
        console.log(response);
        return response.type;
        //if(response.type == 'basic') return 'basic';//response.text();
        //else postMessage({
          'type' : 'log',
          'data' : response.type,
        });
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

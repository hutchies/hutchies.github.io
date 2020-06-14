onmessage = function(event){
  var message = event.data;

  if (message.type === "lookup") {
    var passage = message.passage;
    var version = message.version;
    var url = "https://www.biblegateway.com/passage/?search="+encodeURIComponent(passage)+'&version='+encodeURIComponent(version);

    fetch(url, {method: 'get', mode: 'no-cors'})
      .then(function(response){
        //console.log(response);
        return response.text();
        //if(response.type == 'basic') return 'basic';//response.text();
        /* else postMessage({
          'type' : 'log',
          'data' : response.type,
        });*/
      })
      .then(function(data){
        //console.log(data);
        postMessage({
          'type' : 'found',
          'data' : data,
          'passage': passage
        })
      });
    }
}

postMessage({
  'type' : 'ready'
});

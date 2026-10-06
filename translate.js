var app = new Vue({
  el: '#translator',
  data: {
    orig_text_full: '',
    trans_text_full: '',
    orig_text: [{ text: '', google: '', linguee: {}}],
    trans_text: [{ text: ''}],
    started: false,
    trans_lang: 'en',
    orig_lang: 'de',
  },
  methods: {
    split_orig: function (event){
      this.started = true;
      let orig_lines = this.orig_text_full.split('.').filter(l => l.trim() !== '').map(l => l = l+'.');
      this.orig_text = [];
      orig_lines.forEach((l) => {
        this.orig_text.push({text: l, google: '', linguee: {}});
        google_trans(l, this.orig_lang, this.trans_lang).then(trans => console.log(trans));
      });
      this.trans_text = Array(this.orig_text.length).fill({text: ''});

    }
  }
});

async function google_trans(text, from, to){
  let url = 'https://translate.google.com/#view=home&op=translate&sl='+from+'&tl='+to+'&text='+encodeURIComponent(text);
  //console.log(url);
  let response = await fetch(url);
  if(response.ok){
    let data = response.text();
    let parser = new DOMParser();
    let doc = parser.parseFromString(data, 'text/html');
    //let trans = doc.querySelector('.translation').innerHTML;

    return data;
    //console.log(text,data);
  }else{
    return 'Google Translate request failed...'
  }

}

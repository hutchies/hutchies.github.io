class TimeDuration {
  constructor(start, end){
    this.start = start;
    this.end = end;
  }

  overlaps(t){
    if(this.start > t.start || this.end < t.end) return true;
    return false;
  }

}

class TimePoint extends TimeDuration{
  constructor(t){
    this.time = t;
  }
  get start(){
    return this.time;
  }

  get end(){
    return this.time;
  }
}

class ScorePageTimePoint extends TimePoint {
  constructor(page, offset = -1){
    this.page = page; // page is a canvas or image or anything with a width
    if(offset == -1){
      this.offset = new Fraction(0, this.page.width);
    }else{
      this.offset = offset;
    }
  }
}

class Metre {
  constructor(num, denom){
  this.num = num;
  this.denom = Fraction(denom); // will this work with alternatives?
  }
  click_bpm(tempo){
    return Fraction(tempo.bpm).div(tempo.unit).mul(this.denom);
  };
  bar_bpm(tempo){
    return Fraction(this.click_bpm(tempo), this.num);
  };
  click_duration(tempo){
    var top = Fraction(60).mul(tempo.unit);
    var bottom = Fraction(tempo.bpm).mul(this.denom);
    return top.div(bottom);
  };
  bar_duration(tempo){
    return this.click_duration(tempo).mul(this.num);
  };
}

var Rhythm = {
    crotchet: Fraction(4,1),
    quaver: Fraction(8,1),
    minim: Fraction(2,1),
    semibreve: Fraction(1,1),
    semiquaver: Fraction(16,1),
    demisemiquaver: Fraction (32,1),
    tuplet: function(how_many, in_time_of, unit){
      //return ito_unit.mul(how_many).div(hm_unit.mul(in_time_of));
      return Fraction(how_many, in_time_of).mul(unit);
    },
    triplet: function(unit){
      return this.tuplet(3, 2, unit);
    },
    dot: function(unit){
      return this.tuplet(2, 3, unit);
    }
}

class Tempo {
  constructor(unit = 'c', bpm){
    this.unit = unit;
    this.bpm = bpm;
  }
}

class Location {
  constructor(parent){
    this.parent = parent;
  }

  destroy(){
    this.parent.remove(this);
  }
}

class SecondsLocation extends Location{
  constructor(performance, secs){
    super(performance);
    this.time = secs;
  }

  static compare(a, b){
    return a.time - b.time;
  }

  static nearestLoc(loc, a, b){
    return Math.abs(b.time - loc.time) < Math.abs(a.time - loc.time) ? b : a;
  }

}

class BarBeatLocation extends Location {
  constructor(score, bar, offset){ // offset is a Rhythm (i.e. fraction_)
    super(score);
    this.time = {bar: bar, offset: offset};
  }

  static compare(a, b){
    let bd = a.time.bar - b.time.bar;
    if(bd != 0) return bd;
    return a.time.offset.sub(b.time.offset);
  }

  static nearestLoc(loc, a, b){
    // TODO need to work this out... I think I need to include a ref to the score somehow.
  }
}

class ScoreImageLocation extends Location{
  constructor(score, page, x, y, lines = [0]){ // page is a number
    super(score);
    this.time = {page: page, x: x, y: y};
    this.lines = lines;
  }

  which_line(){
    return this.lines.indexOf(this.lines.filter(l => this.time.y > l).slice(-1)[0]);
  }

  static compare(a, b){
    let pd = a.time.page - b.time.page;
    if(pd != 0) return pd;
    let yd = a.which_line() - b.which_line();
    if(yd != 0) return yd;
    return a.time.x - b.time.x;
  }

}

class TimeStructure {
  constructor(){
    this.locs = [];
    this.bindings = [];
  }

  addLoc(loc){
    this.points.push(loc);
    this.points = this.points.sort(loc.constructor.compare);
  }

  findNearestPoint(loc){
    return this.points.reduce((a,b) => loc.constructor.nearestLoc(a,b));
  }

  deletePointNearest(loc){
    let p = this.findNearestPoint(loc);
    this.deletePointAt(loc);
  }

  deletePointAt(loc){
    this.points.splice(this.points.findIndex(loc), 1);
  }
  
}

class RecordingStructure extends TimeStructure {
  constructor(file){
    this.file = file;
    this.locs = [];
    super();
  }

  newLoc(secs){
    let sl = new SecondsLocation(this, secs);
    this.locs.push(sl);
    return sl;
  }

}

class ScoreImageStructure extends TimeStructure {
  constructor(images){
    this.images = images;
    super();
  }

  draw(loc){

  }

}

class BarBeatStructure extends TimeStructure {
  constructor(bars){
    this.bars = bars;
  }
}


function relativeTime(duration, point){
  let e = duration.end;
  let s = duration.start;
  let p = point;
  if(!(e instanceof Fraction)) e = new Fraction(e);
  if(!(s instanceof Fraction)) s = new Fraction(s);
  if(!(p instanceof Fraction)) p = new Fraction(p);
  return p.div(e.sub(s));
}

function frac(...fracs){
  let ret = []
  for(f of fracs){
    if(f instanceof Fraction){
      ret.push(f);
    }else{
      ret.push(new Fraction(f));
    }
  }
  return ret;
}

function points_to_durs(points_array, span = {start: null, end: null}){
  let durs = [];
  let {start, end} = span;
  let points = points_array.map(p => {
    if(!(p instanceof Fraction)) return new Fraction(p);
    return p;
  }).sort((a,b) => b.compare(a));
  if(!start) start = points[0];
  if(!end) end = points[points.length - 1];
  [start, end] = frac(start, end);
  for(p of points){
    if(!start.equals(p) && end.compare(p) > 0){
      console.log(start.toString(), end.toString());
      durs.push({start: start, end: p});
    }
    start = p.clone(); // Also cuts duplicates?
  }
  if(!durs[durs.length - 1].end.equals(end)) durs.push({start: durs[durs.length - 1], end: end});
  return durs;
}

class Binding {
  static function bind(aLoc, bLoc){

  }
}

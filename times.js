class Instant {
    constructor(parent, time){
        this.parent = parent;
        this.inner_time = time;
        this.bindings = [];
    }

    set data(data){
        this.data = data;
    }

    get data(){
        return this.data;
    }

    bind(binding){ // binding is another instant from a different timeline
        if(binding.parent == this.parent || this.boundTo(binding.parent)) throw 'Cannot bind instants from the same timeline!';
        this.bindings.push(binding);
    }

    unbind(binding){
        if(this.bindings.includes(binding)) this.bindings.splice(this.bindings.indexOf(binding), 1);
    }

    boundTo(timeline){
        return this.bindings.some(b => b.parent == timeline);
    }

    get time(){
        return this.inner_time;
    }
    
    boundTime(lead){ // lead is a Timeline
        if(lead == this.parent || !lead) return this.time;
        let binding = this.bindings.find(b => b.parent == lead);
        if(binding) return binding.time;
        else return NaN;
    }

    static compare(a, b){
        return a.time - b.time;
    }

}

class ScoreInstant extends Instant {
    constructor(parent, page, offset){
        super(parent, {page, offset});
    }

    get time(){
        if(page == 0) return 0;
        return 9999999; // TODO fix! Should not be callable I think.
    }
}

class Timeline {
    constructor(name, type, times = undefined){
        this.name = name;
        this.type = type; // will this work?
        this.instants = [];
        this.following = false;
        if(times){
            for(let t of times) this.addLoc(t);
        }
    }

    addLoc(time){
        let i = new this.type.constructor(this, time);
        this.instants.push(i);
        this.instants.sort((a,b) => Instant.compare(a,b));
        return i;
    }

    static bind(a, b){
        a.parent.bindWith(a, b);
        b.parent.bindWith(b, a);
    }

    static unbind(a, b){
        a.parent.unbindFrom(a, b);
        b.parent.unbindFrom(b, a);
    }

    bindWith(mine, theirs){
        if(!(mine instanceof Instant)) mine = this.addLoc(mine); // presume it's a time instead
        mine.bind(theirs);
    }

    unbindFrom(mine, theirs){
        if(!(mine instanceof Instant)) throw 'No such binding exists!';
        mine.unbind(theirs);
    }

    at(time, unbound = 'bound'){
        if(!this.following || unbound == 'unbound') return this.instants.find(i => i.time == time);
        else return this.instants.find(i => i.boundTime(this.following) == time);
    }

    firstAfter(time){
        let found = undefined;
        for(let [j,i] of this.instants.entries()){
            //console.log(i.time, time, i.time >= time || j == this.instants.length - 1);
            if(i.time > time && (!this.following || i.bindings.some(b => b.parent == this.following) || j == (this.instants.length - 1))){
                found = i;
                break;
            }
        }
        return found;
    }

    lastBefore(time){
        if(this.instants.count == 0) return undefined;
        let found = this.instants[0];
        for(let i of this.instants){
            if(i.time >= time) break;
            if(!this.following || i.bindings.some(b => b.parent == this.following)) found = i;
        }
        return found;
    }

    // TODO refactor out this.following bits – can access directly from instants with parent property? Then can directly use time rather than boundTime

    speedAt(time){ // TODO rewrite in terms of Fractions
        // time input is at the pace of the leading timeline
        if(!this.following) return {n: 1, d: 1}; // Normal speed when we are in the lead
        let prev = this.at(time, 'unbound');
        //console.log('prev is ',prev)
        if(!prev || !prev.boundTo(this.following)) prev = this.lastBefore(time);
        let post = this.firstAfter(time);
        let [orig_prev, orig_post, bound_prev, bound_post] = [0, 0, 0, 0];
        if(prev){
            orig_prev = prev.time;
            bound_prev = prev.boundTime(this.following);
        }
        if(post){
            orig_post = post.time;
            bound_post = post.boundTime(this.following);
        }else{
            return {n: 1, d: 1};
        }
        let orig_diff = orig_post - orig_prev;
        let bound_diff = bound_post - bound_prev;
        let message = `calculating speed. time is ${time}. Originals: ${orig_post} - ${orig_prev} = ${orig_diff}; 
Bounds: = ${bound_post} - ${bound_prev} = ${bound_diff}.
Result: = ${orig_diff} / ${bound_diff}`;
        //console.log(message);
        //if(bound_diff == 0) return 0;
        
        //return orig_diff / bound_diff;
        return {n: orig_diff, d: bound_diff};
    }

    closest(time, unbound = 'bound'){
        let distance = 9999999;
        let index = -1;
        let lead = this;
        if(this.following && unbound != 'unbound') lead = this.following;
        for([e, i] of this.instants){
            if(e.time == time){
                index = i;
                distance = 0;
                break;
            }else if(abs(e.boundTime(lead) - time) < distance){
                distance = abs(e.time - time);
                index = i;
            }
        }
        return this.instants[i];
    }
}

function relativeTime(duration, point){
    let e = duration.end;
    let s = duration.start;
    let p = point;
    if(!(e instanceof Fraction)) e = new Fraction(e);
    if(!(s instanceof Fraction)) s = new Fraction(s);
    if(!(p instanceof Fraction)) p = new Fraction(p);
    return point.div(e.sub(s));
}

/*let t_a = new Timeline(new Instant(), [0, 1, 2, 3, 4, 5]);
let t_b = new Timeline(new Instant(), [0, 1.1, 2.3, 4.7, 5.2, 6]);
for(let [j,i] of t_b.instants.entries()){
    if(j < t_a.instants.length) Timeline.bind(i, t_a.instants[j]);
}
t_b.following = t_a;
//console.log(t_b.at(10), t_a.at(10), t_b.speedAt(10), t_a.speedAt(10));
for(let i = 0; i < 5; i += 1){
    console.log(Object.values(t_b.speedAt(i)).join('/'));
}*/
//console.log(t_a, t_b);

class ScoreTimeline extends Timeline {
    constructor(name, images, times = undefined){
        super(name, new ScoreInstant(), times);
        this.images = images; // So keep it separate from specific times
    }
}

class AudioTimeline extends Timeline {
    constructor(name, audio, times = undefined){
        super(name, new Instant(), times);
        this.audio audio;
    }
}

export { ScoreTimeline, AudioTimeline };
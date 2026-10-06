const $force = document.querySelectorAll('#force')[0]
const $touches = document.querySelectorAll('#touches')[0]
const canvas = document.querySelectorAll('canvas')[0]
const context = canvas.getContext('2d')
let lineWidth = 0
let isMousedown = false
let points = []
let draw_log = []

canvas.width = window.innerWidth * 2
canvas.height = window.innerHeight * 2

if(storageAvailable('localStorage')){
  var json = localStorage.getItem('draw_state');
  if(json){
    //console.log(json)
    draw_log = JSON.parse(pako.inflateRaw(json, {to: 'string'}));
    //draw_log = [];
    draw_log.forEach(function(pts,j){
      if(j % 2 != 0) return;
      context.strokeStyle = 'black';
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.lineWidth = pts[0].lineWidth;
      context.beginPath();
      context.moveTo(pts[0].x, pts[0].y);
      if(pts.length >= 3){
          for (i = 1; i < pts.length - 2; i ++){
              var xc = (pts[i].x + pts[i + 1].x) / 2;
              var yc = (pts[i].y + pts[i + 1].y) / 2;
              context.lineWidth = pts[i].lineWidth;
              context.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
          }
          context.lineWidth = pts[i+1].lineWidth;
          context.quadraticCurveTo(pts[i].x, pts[i].y, pts[i+1].x,pts[i+1].y);

      }
      context.stroke();
    })
  }
}

const requestIdleCallback = window.requestIdleCallback || function (fn) { setTimeout(fn, 1) };

for (const ev of ["touchstart", "mousedown"]) {
  canvas.addEventListener(ev, function (e) {
    let pressure = 0.1;
    let x, y;
    if (e.touches && e.touches[0] && typeof e.touches[0]["force"] !== "undefined") {
      if (e.touches[0]["force"] > 0) {
        pressure = e.touches[0]["force"]
      }
      x = e.touches[0].pageX * 2
      y = e.touches[0].pageY * 2
    } else {
      pressure = 1.0
      x = e.pageX * 2
      y = e.pageY * 2
    }

    isMousedown = true

    lineWidth = Math.log(pressure + 1) * 40
    context.lineWidth = lineWidth// pressure * 50;
    context.strokeStyle = 'black'
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    context.moveTo(x, y)

    points = [];

    points.push({ x, y, lineWidth })
    draw_log.push(points)
  })
}

for (const ev of ['touchmove', 'mousemove']) {
  canvas.addEventListener(ev, function (e) {
    if (!isMousedown) return
    e.preventDefault()

    let pressure = 0.1
    let x, y
    if (e.touches && e.touches[0] && typeof e.touches[0]["force"] !== "undefined") {
      if (e.touches[0]["force"] > 0) {
        pressure = e.touches[0]["force"]
      }
      x = e.touches[0].pageX * 2
      y = e.touches[0].pageY * 2
    } else {
      pressure = 1.0
      x = e.pageX * 2
      y = e.pageY * 2
    }

    // smoothen line width
    lineWidth = (Math.log(pressure + 1) * 40 * 0.2 + lineWidth * 0.8)
    points.push({ x, y, lineWidth })
    draw_log[draw_log.length - 1].push({ x, y, lineWidth });

    context.strokeStyle = 'black'
    context.lineCap = 'round'
    context.lineJoin = 'round'
    // context.lineWidth   = lineWidth// pressure * 50;
    // context.lineTo(x, y);
    // context.moveTo(x, y);

    if (points.length >= 3) {
      const l = points.length - 1
      const xc = (points[l].x + points[l - 1].x) / 2
      const yc = (points[l].y + points[l - 1].y) / 2
      context.lineWidth = points[l - 1].lineWidth
      context.quadraticCurveTo(points[l - 1].x, points[l - 1].y, xc, yc)
      context.stroke()
      context.beginPath()
      context.moveTo(xc, yc)
    }

    requestIdleCallback(() => {
      $force.textContent = 'force = ' + pressure

      const touch = e.touches ? e.touches[0] : null
      if (touch) {
        $touches.innerHTML = `
          touchType = ${touch.touchType} ${touch.touchType === 'direct' ? '👆' : '✍️'} <br/>
          radiusX = ${touch.radiusX} <br/>
          radiusY = ${touch.radiusY} <br/>
          rotationAngle = ${touch.rotationAngle} <br/>
          altitudeAngle = ${touch.altitudeAngle} <br/>
          azimuthAngle = ${touch.azimuthAngle} <br/>
        `

        // 'touchev = ' + (e.touches ? JSON.stringify(
        //   ['force', 'radiusX', 'radiusY', 'rotationAngle', 'altitudeAngle', 'azimuthAngle', 'touchType'].reduce((o, key) => {
        //     o[key] = e.touches[0][key]
        //     return o
        //   }, {})
        // , null, 2) : '')
      }
    })
  })
}

for (const ev of ['touchend', 'touchleave', 'mouseup']) {
  canvas.addEventListener(ev, function (e) {
    let pressure = 0.1;
    let x, y;

    if (e.touches && e.touches[0] && typeof e.touches[0]["force"] !== "undefined") {
      if (e.touches[0]["force"] > 0) {
        pressure = e.touches[0]["force"]
      }
      x = e.touches[0].pageX * 2
      y = e.touches[0].pageY * 2
    } else {
      pressure = 1.0
      x = e.pageX * 2
      y = e.pageY * 2
    }

    isMousedown = false

    context.strokeStyle = 'black'
    context.lineCap = 'round'
    context.lineJoin = 'round'

    if (points.length >= 3) {
      const l = points.length - 1
      context.quadraticCurveTo(points[l].x, points[l].y, x, y)
      context.stroke()
    }

    //console.log(points);
    if(storageAvailable('localStorage')){
      var compressed = pako.deflateRaw(JSON.stringify(draw_log), {to: 'string'});
      localStorage.setItem('draw_state', compressed);
    }

    points = []
    lineWidth = 0
  })
};

function storageAvailable(type) {
  var storage;
  try {
      storage = window[type];
      var x = '__storage_test__';
      storage.setItem(x, x);
      storage.removeItem(x);
      return true;
  }
  catch(e) {
      return e instanceof DOMException && (
          // everything except Firefox
          e.code === 22 ||
          // Firefox
          e.code === 1014 ||
          // test name field too, because code might not be present
          // everything except Firefox
          e.name === 'QuotaExceededError' ||
          // Firefox
          e.name === 'NS_ERROR_DOM_QUOTA_REACHED') &&
          // acknowledge QuotaExceededError only if there's something already stored
          (storage && storage.length !== 0);
  }
}

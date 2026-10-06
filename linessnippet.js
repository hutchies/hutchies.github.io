let src = cv.imread('canvasInput');
let dst = cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC3);
let lines = new cv.Mat();
let color = new cv.Scalar(255, 0, 0);
cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY, 0);
cv.Canny(src, src, 50, 200, 3);
// You can try more different parameters
cv.HoughLinesP(src, lines, 1, Math.PI, 2, src.rows / 2, 5);
// draw lines
let segments = [];

function average(array, element){
    return (array.reduce((a,b)=>a[elememt] + b[element], 0) / array.length) || 0;
}

for (let i = 0; i < lines.rows; ++i){
    segments.push({x1: lines.data32S[i * 4], y1: lines.data32S[i * 4 + 1], x2: lines.data32S[i * 4 + 2], y2: lines.data32S[i * 4 + 3]});
}
lines.delete();
segments.sort((a,b) => a.x1 - b.x1);
let filtered_segs = [];
let averaging_segs = [];
if(segments.length > 0) let first_x = segments[0].x1;;
for (let s of segments){
    if(s.x1 - first_x < src.cols / 100){
        averaging_segs.push(s);
        first_x = s.x1;
    }else{
        let avg = Object.keys(averaging_segs).map(x => average(avg, x));
        filtered_segs.push(avg);
        averaging_segs = [];
        first_x = s.x1;
    }
}
for (let s of filtered_segs) {
    let startPoint = new cv.Point(s.x1, s.y1);
    let endPoint = new cv.Point(s.x2, s.y2);
    cv.line(dst, startPoint, endPoint, color);
}
cv.imshow('canvasOutput', dst);
src.delete(); dst.delete();

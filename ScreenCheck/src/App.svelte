<script>
import pixelmatch from 'pixelmatch';
import {Howl, Howler} from 'howler';
import emailjs from 'emailjs-com';
import * as jq from 'jquery';
let phase = ['starting', 'selecting', 'monitoring']
let currentPhase = 0;
let options = {
	audio: false,
	video: "always",
	cursor: "never",
	displaySurface: ["monitor", "window", "browser"]
}
let canvas;
let video;
let dragging = false;
let startCoords;
let endCoords;
let secondCanvas;
let selected = false;
let rect;
let timer;
let paused = false;
let origData;
let bell = new Howl({
	src: ['bell.webm', 'bell.mp3']
});
let wakeLock = null;
let resultText = "";
let notifyTypes = {
	'Bell sound': true,
	'Email': false,
	'Webhook': true
};

emailjs.init("user_MGIKnYkxy8hzSkop3jK1h");

Object.defineProperty(HTMLMediaElement.prototype, 'playing', {
    get: function(){
        return !!(this.currentTime > 0 && !this.paused && !this.ended && this.readyState > 2);
    }
})

async function selectArea(){
	try {
		 video.srcObject = await navigator.mediaDevices.getDisplayMedia(options);
		 video.play();
		 nextPhase();
	}catch(err) {
		alert('Error: '+err);
	}
}

function reset(){
	stopTimer();
	stopCapture();
	startCoords = null;
	endCoords = null;
	selected = false;
	paused = false;
	rect = null;
	dragging = false;
	currentPhase = 0;
}

function stopCapture(){
	let obj = video.srcObject;
	if(!obj) return;
	let tracks = obj.getTracks();
	for(let t of tracks){
		t.stop();
	}
	video.srcObject = null;
}

function nextPhase(){
	currentPhase++;
	if(currentPhase == phase.length) currentPhase = 0;
}

function firstPic(){
		canvas.setAttribute('width', video.videoWidth);
		canvas.setAttribute('height', video.videoHeight);
		var context = canvas.getContext('2d');
		context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
		saveCanvas();
}

function saveCanvas(){
	secondCanvas.width = canvas.width;
	secondCanvas.height = canvas.height;
	let context = secondCanvas.getContext('2d');
	context.drawImage(canvas, 0, 0, canvas.width, canvas.height);
}

function drawDragBox(){
	let context = canvas.getContext('2d');
	context.drawImage(secondCanvas, 0, 0, canvas.width, canvas.height);
	context.beginPath();
	context.lineWidth = '3';
	context.strokeStyle = 'red';
	rect = getRectSize(startCoords, endCoords);
	context.rect(rect.x, rect.y, rect.width, rect.height);
	context.stroke();
	selected = true;
}

function getRectSize(startCoords, endCoords){
	let x = Math.min(startCoords.x, endCoords.x);
	let y = Math.min(startCoords.y, endCoords.y);
	let width = Math.abs(startCoords.x - endCoords.x);
	let height = Math.abs(startCoords.y - endCoords.y);
	return {
		x: x,
		y: y,
		width: width,
		height: height
	};
}

function startDrag(e){
	dragging = true;
	startCoords = getMousePos(canvas, e);
	endCoords = getMousePos(canvas, e);
	drawDragBox();
}

function drag(e){
	if(!dragging) return;
	endCoords = getMousePos(canvas, e);
	drawDragBox();
}

function endDrag(e){
	if(!dragging) return;
	dragging = false;
	endCoords = getMousePos(canvas, e);
	drawDragBox();
}

function getMousePos(canvas, evt){
	var rect = canvas.getBoundingClientRect(), // abs. size of element
      scaleX = canvas.width / rect.width,    // relationship bitmap vs. element for X
      scaleY = canvas.height / rect.height;  // relationship bitmap vs. element for Y

  return {
    x: Math.floor((evt.clientX - rect.left) * scaleX),   // scale mouse coordinates after they have
    y: Math.floor((evt.clientY - rect.top) * scaleY)     // been adjusted to be relative to element
  }
}

function startMonitoring(){
	if(selected == false && !confirm('You haven\'t selected an area of the screen yet – do you really want to monitor the whole screen?')) return;
	if(!rect) rect = {x: 0, y: 0, width: canvas.width, height: canvas.height};
	canvas.width = rect.width;
	canvas.height = rect.height;
	let context = canvas.getContext('2d');
	context.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
	origData = context.getImageData(0, 0, canvas.width, canvas.height);
	currentPhase = 2;
	paused = false;
	secondCanvas.width = rect.width;
	secondCanvas.height = rect.height;
	timer = setInterval(checkImage, 1000);
	stayAwake();
}

function stayAwake(){
	requestWakeLock();
	document.addEventListener('visibilitychange', handleVisibilityChange());
}

async function requestWakeLock(){
	if(!'wakelock' in navigator) return;
		try {
			wakeLock = await navigator.wakeLock.request('screen');
		}catch (err){
			console.log('Error requesting wake lock: '+err.message);
		}
}

function handleVisibilityChange(){
    if (wakeLock !== null && document.visibilityState === 'visible') {
      requestWakeLock();
    }
  }

function pauseMonitoring(){
	paused = true;
	stopTimer();
}

function stopTimer(){
	if(timer) clearInterval(timer);
	timer = null;
	if(wakeLock){
		wakeLock.release().then(() => { wakeLock = null});
	}
	document.removeEventListener('visibilitychange', handleVisibilityChange);
}

function checkTime(i) {
  if (i < 10) {
    i = "0" + i;
  }
  return i;
}

function timeNow(){
	let today = new Date();
	return today.getHours() + ':' + checkTime(today.getMinutes()) + ':' + checkTime(today.getSeconds());
}

function sendAlert(){
	if(notifyTypes['Bell sound']){
		bell.play();
	}

	if(notifyTypes['Email']){
		emailjs.send("default_service", "template_mz0gcq4", {canvas: secondCanvas.toDataURL()}).then((response) => {
			resultText = 'Email successfully sent at '+timeNow();
		}, (error) => {
			resultText = 'Email not sent at '+timeNow()+': '+error;
		});
	}

	if(notifyTypes['Webhook']){
		let body = {
			'value1': secondCanvas.toDataURL()
		};

		jq.post("https://maker.ifttt.com/trigger/screen_changed/with/key/dv2orwMYjtWlZhPo6IfvMx", body).done(function(data){
			resultText = 'Webhook triggered at '+timeNow();
		}).fail(function(){
			resultText = 'Webhook failed at '+timeNow();
		});/*
		const response = await fetch(, {
			method: 'POST',
			headers: {
				'Content-Type': 'multipart/form-data'
			},
			body: formData
		});
		if(response.ok){
			resultText = 'Webhook triggered at '+timeNow();
		}else{
			resultText = 'Response to webhook request at '+timeNow()+': '+response.statusText;
			console.log(response);
		}*/
	}
}

function checkImage(){
	let context = secondCanvas.getContext('2d');
	context.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, secondCanvas.width, secondCanvas.height);
	let newData = context.getImageData(0, 0, secondCanvas.width, secondCanvas.height);
	let mismatch = pixelmatch(origData.data, newData.data, null, rect.width, rect.height, {threshold: 0.1});
	if(mismatch > 0){
		// Something's changed!
		sendAlert();

		// Reset monitoring area
		let context = canvas.getContext('2d');
		context.drawImage(secondCanvas, 0, 0, canvas.width, canvas.height);
		origData = context.getImageData(0, 0, canvas.width, canvas.height);
	}
}

function testBell(){
	bell.play();
}
</script>
<svelte:head>
	<title>Screen Monitor</title>
</svelte:head>
<main on:mouseup={endDrag}>
	<h1>Screen monitor</h1>
	<div id="messages">
	{#if phase[currentPhase] == 'starting'}
		<p>Click below to choose an area of the screen to monitor. (All monitoring is done in your browser: you'll have to give permission for it to use your camera, but no data will be sent anywhere.)
		</p>
	{:else if phase[currentPhase] == 'selecting'}
		Drag on the image to select a portion to monitor for changes:
	{:else if phase[currentPhase] == 'monitoring'}
		<p>Monitoring this portion of the screen for changes:</p>
		{#if paused}
		<p class="paused">Monitoring paused: press 'Start monitoring' below to restart</p>
		{/if}
	{/if}
	</div>
	<canvas bind:this={canvas} class:hide={phase[currentPhase] == 'starting'} on:mousedown={startDrag} on:mousemove={drag} on:touchstart={startDrag} on:touchmove={drag} on:touchend={endDrag} style="max-width: 90vw; max-height: 70vh; text-align: center;"/>
	<video bind:this={video} on:canplay={firstPic} class="hide"/>
	<canvas bind:this={secondCanvas} class="hide" />
	<div>
		Notify via: 
		{#each Object.keys(notifyTypes) as n}
			<div>
				<input type=checkbox bind:checked={notifyTypes[n]} /> {n}
			</div>
		{/each}
	</div>
	<div id="result">{resultText}</div>
	<div id="buttons">
		{#if phase[currentPhase] == 'starting'}
		<button on:click={selectArea}>Choose an area to monitor</button>
		{:else if phase[currentPhase] == 'selecting'}
		<button on:click={reset}>Cancel</button>
		<button on:click={startMonitoring}>Start monitoring</button>
		{:else if phase[currentPhase] == 'monitoring'}
		<button on:click={reset}>Cancel and reset</button>
		{#if !paused}
			<button on:click={pauseMonitoring}>Pause monitoring</button>
		{:else}
			<button on:click={startMonitoring}>Start monitoring</button>
		{/if}
		<button on:click={testBell}>Test alert sound</button>
		{/if}
	</div>
</main>

<style>
	main {
		text-align: center;
		padding: 1em;
		max-width: 240px;
		margin: 0 auto;
	}

	.hide {
		display: none;
	}

	.paused {
		color: red;
		font-weight: bold;
		font-size: 2em;
	}

	h1 {
		color: #ff3e00;
		text-transform: uppercase;
		font-size: 2em;
		font-weight: 100;
	}

	#messages {
		width: 80%;
		margin: auto;
	}

	@media (min-width: 640px) {
		main {
			max-width: none;
		}
	}
</style>
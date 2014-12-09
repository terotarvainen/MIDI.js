/*
	-------------------------------------
	MIDI.Player : 0.3
	-------------------------------------
	https://github.com/mudcube/MIDI.js
	-------------------------------------
	#jasmid
	-------------------------------------
*/

if (typeof (MIDI) === "undefined") var MIDI = {};
if (typeof (MIDI.Player) === "undefined") MIDI.Player = {};

(function() { "use strict";

var root = MIDI.Player;
root.callback = undefined; // your custom callback goes here!
root.restart = 0;
root.playing = false;
root.timeWarp = 1;
root.currentTick = 0;
root.endTick = 0;
root.playbackSpeedCoef = 1;
root.animationCallback = undefined;
root.currentPlaybackTick = 0;
root.lastNotedMidiTick = 0;

root.start =
root.resume = function () {

	startAudio(root.currentTick);

	if ( root.animationCallback ) {
		root.animating = true;
		root.animationFrame();
	}
};

root.pause = function () {
	stopAudio();
	root.animating = false;
};

root.stop = function () {
	stopAudio();
	root.restart = 0;
	root.currentTick = 0;
	root.animating = false;
};

root.addListener = function(callback) {
	onMidiEvent = callback;
};

root.removeListener = function() {
	onMidiEvent = undefined;
};

root.registerAnimationCallback = function( callback ) {
	root.animationCallback = callback;
};

root.setPlaybackTempo = function(playbackSpeed) {

	var restart = root.playing;
	if ( root.playing ) {
		stopAudio();
	}
	root.playbackSpeedCoef = playbackSpeed;
	if ( restart ) {
		startAudio(root.currentTick);
	}
};

root.animationFrame = function () {

	if ( root.endTick === 0 ) return;
	if ( !root.animating ) return;

	var ctx = getContext();
	if ( root.lastNotedMidiTick === root.currentTick ) {
		root.currentPlaybackTick = root.lastNotedMidiTick + timeToTick(ctx.currentTime - root.lastPlaybackTimeMarker);
	} else {
		root.currentPlaybackTick = root.currentTick;
		root.lastNotedMidiTick = root.currentTick;
		root.lastPlaybackTimeMarker = ctx.currentTime;
	}

	if ( root.currentPlaybackTick )
		root.reportAnimation();

	if ( root.animating ) {
		window.requestAnimationFrame(root.animationFrame);
	}
};

root.reportAnimation = function() {
	root.animationCallback({
		percentage: root.currentTick / root.endTick,
		tick: root.currentPlaybackTick,
		endTick: root.endTick,
		time: tickToTimeAnimatedConverter,
		events: noteRegistrar
	});
};

// helpers
root.loadMidiFile = function() { // reads midi into javascript array of events
	root.replayer = new Replayer(MidiFile(root.currentData), root.timeWarp);
	root.data = root.replayer.getData();
	root.header = root.replayer.getHeader();
	root.ticksPerSecond = resolveTempo( root.data, root.header );
	root.endTick = getLength(root.data);
};

root.loadFile = function (file, callback) {
	root.stop();
	if (file.indexOf("base64,") !== -1) {
		var data = window.atob(file.split(",")[1]);
		root.currentData = data;
		root.loadMidiFile();
		if (callback) callback(data);
		return;
	}
	///
	var fetch = new XMLHttpRequest();
	fetch.open('GET', file);
	fetch.overrideMimeType("text/plain; charset=x-user-defined");
	fetch.onreadystatechange = function () {
		if (this.readyState === 4 && this.status === 200) {
			var t = this.responseText || "";
			var ff = [];
			var mx = t.length;
			var scc = String.fromCharCode;
			for (var z = 0; z < mx; z++) {
				ff[z] = scc(t.charCodeAt(z) & 255);
			}
			var data = ff.join("");
			root.currentData = data;
			root.loadMidiFile();
			if (callback) callback(data);
		}
	};
	fetch.send();
};

/**
 * Resolve song tempo.
 * Note: Tempo changes in the MIDI file are not currently supported.
 * @return ticksPerSecond
 */
function resolveTempo( midiData, header ) {
	// Find the first setTempo event and return its value.
	for ( var i = 0; i < midiData.length; i++ ) {
		var data = midiData[i][0];
		if ( data.event.subtype == "setTempo" ) {
			return root.header.ticksPerBeat/(data.event.microsecondsPerBeat/1000000);
		}
	}
}

function timeToTick(time) {
	var tick = Math.ceil(time*root.ticksPerSecond/root.playbackSpeedCoef);
	return tick;
}

function tickToTime(tick) {
	var time = tick*root.playbackSpeedCoef/root.ticksPerSecond;
	return time;
}

function tickToTimeAnimatedConverter() {
	return {
		now: tickToTime(root.currentPlaybackTick),
		end: tickToTime(root.endTick)
	};
}

// Playing the audio
var eventQueue = []; // hold events to be triggered
var lastTickOfCurrentPatch = 0; // The tick time of the last event scheduled for playing. Used to trigger loading of next sequence.
var startTime = 0; // to measure time elapse in relation to audio context timer. See getContext().currentTime.
var noteRegistrar = {}; // contains currently active notes
var onMidiEvent = undefined; // listener callback
var scheduleTracking = function (channel, note, currentTime, currentTick, offset, message, velocity) {

	var interval = window.setTimeout(function () {
		var data = {
			channel: channel,
			note: note,
			tick: currentTick,
			endTick: root.endTick,
			now: currentTime,
			end: tickToTime(root.endTick),
			message: message,
			velocity: velocity
		};

		if (message === 128) {
			delete noteRegistrar[note];
		} else {
			noteRegistrar[note] = data;
		}
		if (onMidiEvent) {
			onMidiEvent(data);
		}

		root.currentTick = currentTick;
		if (root.currentTick === lastTickOfCurrentPatch && lastTickOfCurrentPatch < root.endTick) { // grab next sequence
			startAudioTT(queuedTick, true);
		}
	}, currentTime - offset);
	return interval;
};

var getContext = function() {
	if (MIDI.lang === 'WebAudioAPI') {
		return MIDI.Player.ctx;
	} else if (!root.ctx) {
		root.ctx = { currentTime: 0 };
	}
	return root.ctx;
};

var getLength = function(data) {
	var length = data.length;
	var totalTicks = 0;
	for (var n = 0; n < length; n++) {
		totalTicks += data[n][0].ticksToEvent;;
	}
	return totalTicks;
};

var startAudio = function (currentTick, continuousPlay) {

	if (!root.replayer) return;

	if ( !continuousPlay ) {
		if (root.playing) stopAudio();
		root.playing = true;
	}

	var note;
	var queuedTime = 0;
	var queuedTick = 0;
	var currentTime = 0;
	var offset = 0;
	var messages = 0;
	var data = root.data;
	var ctx = getContext();
	var length = data.length;

	startTime = ctx.currentTime;
	root.lastPlaybackTimeMarker = startTime;
	root.lastNotedMidiTick = -1;

	for (var n = 0; n < length && messages < 100; n++) {
		queuedTime += root.playbackSpeedCoef * data[n][1];
		queuedTick += data[n][0].ticksToEvent;
		if ( queuedTick < currentTick ) {
			offset = queuedTime;
			continue;
		}
		currentTime = queuedTime - offset;
		var event = data[n][0].event;
		if (event.type !== "channel") continue;
		var channel = event.channel;
		switch (event.subtype) {
			case 'noteOn':
				if (MIDI.channels[channel].mute) break;
				note = event.noteNumber - (root.MIDIOffset || 0);
				eventQueue.push({
					event: event,
					source: MIDI.noteOn(channel, event.noteNumber, event.velocity, currentTime / 1000 + ctx.currentTime),
					interval: scheduleTracking(channel, note, queuedTime, queuedTick, offset, 144, event.velocity)
				});
				messages ++;
				break;
			case 'noteOff':
				if (MIDI.channels[channel].mute) break;
				note = event.noteNumber - (root.MIDIOffset || 0);
				eventQueue.push({
					event: event,
					source: MIDI.noteOff(channel, event.noteNumber, currentTime / 1000 + ctx.currentTime),
					interval: scheduleTracking(channel, note, queuedTime, queuedTick, offset, 128)
				});
				break;
			default:
				break;
		}
	}
	lastTickOfCurrentPatch = queuedTick;
};

var stopAudio = function () {
	var ctx = getContext();
	root.playing = false;
	root.restart += (ctx.currentTime - startTime) * 1000;
	// stop the audio, and intervals
	while (eventQueue.length) {
		var o = eventQueue.pop();
		window.clearInterval(o.interval);
		if (!o.source) continue; // is not webaudio
		if (typeof(o.source) === "number") {
			window.clearTimeout(o.source);
		} else { // webaudio
			o.source.disconnect(0);
		}
	}
	// run callback to cancel any notes still playing
	for (var key in noteRegistrar) {
		var o = noteRegistrar[key];
		if (noteRegistrar[key].message === 144 && onMidiEvent) {
			onMidiEvent({
				channel: o.channel,
				note: o.note,
				tick: o.tick,
				now: o.now,
				end: o.end*root.playbackSpeedCoef,
				message: 128,
				velocity: o.velocity
			});
		}
	}
	// reset noteRegistrar
	noteRegistrar = {};
};

})();

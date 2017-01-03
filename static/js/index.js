/*
 * (C) Copyright 2014-2015 Kurento (http://kurento.org/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

var ws = new WebSocket('wss://' + location.host + '/one2many');
var video;
var webRtcPeer;
var processingEvent;
var mode;
var session;
var status;
var token;
var loggedUser;

window.onload = function () {
	console = new Console();
	video = document.getElementById('video');
	setTimeout(startProcess, 1000)
	// document.getElementById('call').addEventListener('click', function() { presenter(); } );
	// document.getElementById('viewer').addEventListener('click', function() { viewer(); } );
	// document.getElementById('terminate').addEventListener('click', function() { stop(); } );
}
function startProcess() {
	var url = window.location.href;
	processingEvent = getQueryStringValue("event");
	mode = getQueryStringValue("mode");
	status = getQueryStringValue("status");
	token = getQueryStringValue("token");
	loggedUser=getQueryStringValue("userId")
	if (processingEvent && mode) {
		switch (mode) {
			case 'p':
				presenter();
				break;
			case 'v':
				viewer();
				break;
			default:
				console.log('wrong params');
		}
	}
};
function getQueryStringValue(key) {
	return unescape(window.location.search.replace(new RegExp("^(?:.*[&\\?]" + escape(key).replace(/[\.\+\*]/g, "\\$&") + "(?:\\=([^&]*))?)?.*$", "i"), "$1"));
}
window.onbeforeunload = function () {
	sendMessage({ id: 'terminate', Event: processingEvent, userMode: mode,key:token,user:loggedUser })
}

ws.onmessage = function (message) {
	var parsedMessage = JSON.parse(message.data);
	console.info('Received message: ' + message.data);

	switch (parsedMessage.id) {
		case 'presenterResponse':
			presenterResponse(parsedMessage);
			break;
		case 'viewerResponse':
			viewerResponse(parsedMessage);
			break;
		case 'stopCommunication':
			dispose();
			break;
		case 'iceCandidate':
			webRtcPeer.addIceCandidate(parsedMessage.candidate)
			break;
		default:
			console.error('Unrecognized message', parsedMessage);
	}
}

function presenterResponse(message) {
	if (message.response != 'accepted') {
		var errorMsg = message.message ? message.message : 'Unknow error';
		console.warn('Call not accepted for the following reason: ' + errorMsg);
		dispose();
	} else {
		webRtcPeer.processAnswer(message.sdpAnswer);
	}
}

function viewerResponse(message) {
	if (message.response != 'accepted') {
		var errorMsg = message.message ? message.message : 'Unknow error';
		console.warn('Call not accepted for the following reason: ' + errorMsg);
		dispose();
	} else {
		webRtcPeer.processAnswer(message.sdpAnswer);
	}
}

function presenter() {
	var stopMessage = {
		id: 'terminate',
		Event: processingEvent,
		userMode: 'p',
		key: token,user:loggedUser
	};
	switch (status) {
		case 'stop':
			sendMessage(stopMessage);
			break;
		case 'continue':
			break;
		default:
			console.log('Some error occured in terminating session.')
	}
	if (!webRtcPeer) {
		showSpinner(video);

		var options = {
			localVideo: video,
			onicecandidate: onIceCandidate
		}

		webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(options, function (error) {
			if (error) return onError(error);

			this.generateOffer(onOfferPresenter);
		});
	}
}

function onOfferPresenter(error, offerSdp) {
    if (error) return onError(error);
	// processingEvent=$('#Event').val();
	if (processingEvent) {
		var message = {
			id: 'presenter',
			sdpOffer: offerSdp,
			Event: processingEvent,
			key: token,user:loggedUser
		};
		sendMessage(message);
	}
	else { console.log('no event found!'); }
}

function viewer() {
	if (!webRtcPeer) {
		showSpinner(video);

		var options = {
			remoteVideo: video,
			onicecandidate: onIceCandidate
		}

		webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options, function (error) {
			if (error) return onError(error);

			this.generateOffer(onOfferViewer);
		});
	}
}

function onOfferViewer(error, offerSdp) {
	// processingEvent=$('#Event').val();
	if (error) return onError(error)
	if (processingEvent) {
		var message = {
			id: 'viewer',
			sdpOffer: offerSdp,
			Event: processingEvent,
			key: token,user:loggedUser
		}
		sendMessage(message);
	} else {
		console.log('no event found!');
	}

}

function onIceCandidate(candidate) {
	// processingEvent=$('#Event').val();
	   console.log('Local candidate' + JSON.stringify(candidate));

	   var message = {
		id: 'onIceCandidate',
		candidate: candidate,
		Event: processingEvent,
		key: token,user:loggedUser
	   }
	   sendMessage(message);
}

function stop() {
	// processingEvent=$('#Event').val();
	if (processingEvent) {
		if (webRtcPeer) {
			var message = {
				id: 'stop',
				Event: processingEvent,
				key: token,user:loggedUser
			}
			sendMessage(message);
			dispose();
		}
	} else {
		console.log('no event found!');
	}

}

function dispose() {
	if (webRtcPeer) {
		webRtcPeer.dispose();
		webRtcPeer = null;
	}
	hideSpinner(video);
}

function sendMessage(message) {
	var jsonMessage = JSON.stringify(message);
	console.log('Senging message: ' + jsonMessage);
	ws.send(jsonMessage);
}

//send modified start
// function sendMessage(message,callback) {
// 	waitForConnection(function () {
//         ws.send(message);
//         if (typeof callback !== 'undefined') {
//           callback();
//         }
//     }, 1000);
// }

// function waitForConnection(callback, interval) {
//     if (ws.readyState === 1) {
//         callback();
//     } else {
//         var that = this;
//         // optional: implement backoff for interval here
//         setTimeout(function () {
//             that.waitForConnection(callback, interval);
//         }, interval);
//     }
// };
//send modified end

function showSpinner() {
	for (var i = 0; i < arguments.length; i++) {
		arguments[i].poster = './img/transparent-1px.png';
		arguments[i].style.background = 'center transparent url("./img/spinner.gif") no-repeat';
	}
}

function hideSpinner() {
	for (var i = 0; i < arguments.length; i++) {
		arguments[i].src = '';
		arguments[i].poster = './img/webrtc.png';
		arguments[i].style.background = '';
	}
}

/**
 * Lightbox utility (to display media pipeline image in a modal dialog)
 */
$(document).delegate('*[data-toggle="lightbox"]', 'click', function (event) {
	event.preventDefault();
	$(this).ekkoLightbox();
});

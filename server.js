var path = require('path');
var url = require('url');
var express = require('express');
var minimist = require('minimist');
var ws = require('ws');
var kurento = require('kurento-client');
var fs = require('fs');
var https = require('https');
var sql = require('mssql');

var config = {
    user: 'sa',
    password: 'Password@123',
    server: 'localhost',
    port: 1433,
    database: 'nodeTest',
    driver: 'tedious',
    options: {
        instanceName: 'SQLEXPRESS'
    }
};

var argv = minimist(process.argv.slice(2), {
    default: {
        as_uri: 'https://52.187.34.155:443/',
        ws_uri: 'ws://52.187.34.155:8888/kurento' //using VM KMS 
    }
});

var options =
	{
		key: fs.readFileSync('kazap2p/kazap2p.key'),
		cert: fs.readFileSync('kazap2p/5db5e24c5e912b1d.crt'),
		ca: [fs.readFileSync('kazap2p/1.crt'),fs.readFileSync('kazap2p/2.crt'),fs.readFileSync('kazap2p/gd_bundle-g2-g1.crt')]
	};

var app = express();

var idCounter = 0;
var candidatesQueue = {};
var kurentoClient = null;
var presenter = [];
var recordData = [];
var viewers = [];
var noPresenterMessage = 'No active presenter. Try again later...';

var asUrl = url.parse(argv.as_uri);
var port = asUrl.port;

var server = https.createServer(options, app).listen(port, function () {
    console.log('Kurento Tutorial started');
    console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});

sql.connect(config, function (error) {
    if (error) // Connect to database and checks table records test
        console.log(error);
    var request = new sql.Request();
    request.query('select * from sessionManager', function (error, recordset) {
        if (error) console.log(error);
        console.log('Dbresponse: ' + recordset);
    })
});

var wss = new ws.Server({
    server: server,
    path: '/one2many'
});

function nextUniqueId() {
    idCounter++;
    return idCounter.toString();
}

/*
 * Management of WebSocket messages
 */
wss.on('connection', function (ws, eventId) {

    var sessionId = nextUniqueId();
    console.log('Connection received with sessionId ' + sessionId + ' and Event:' + eventId + ' @79 onConnection');
    ws.on('error', function (error) {
        console.log('Connection ' + sessionId + ' error' + ' event ' + eventId + ' @82 onError');
        stop(sessionId, eventId);
    });
    ws.on('close', function () {
        console.log('Connection ' + sessionId + ' and event ' + eventId + ' closed. @86 onClose');
        //stop(sessionId, eventId);//case 1 for windows onbeforeunload
    });
    ws.on('message', function (_message) {
        // var con=sql.createConnection(config);
        // var q='INSERT INTO sessionManager VALUES ?';
        var message = JSON.parse(_message);
        //console.log('Connection ' + sessionId+' Event: '+message.Event + ' received message '+message.id);
        var eventSession = {
			eventId: message.Event,
			Key: ws.upgradeReq.headers['sec-websocket-key'],
			id: message.id,
			Description: 'test'
		};
		recordData.push(eventSession);
        // con.query(q,eventSession,
        // function(err, result){
        // 	console.log(err);
        // 	console.log(result);
        // })
        switch (message.id) {
            case 'presenter':
                startPresenter(sessionId, ws, message.sdpOffer, message.Event, function (error, sdpAnswer) {
					//call api to check and consume
					// var apiData = 'token=' + message.key + '&userId=' + message.user;
					// performRequest('/api/Common/ConsumeP2PToken', 'POST', apiData, function (result) {
					// 	if (result.status != 200) {
					// 		return ws.send(JSON.stringify({
					// 			id: 'presenterResponse',
					// 			response: 'rejected',
					// 			Event: message.Event,
					// 			message: result.error
					// 		}));
					// 	}
					// });

                    if (error) {
                        return ws.send(JSON.stringify({
                            id: 'presenterResponse',
                            response: 'rejected',
                            Event: message.Event,
                            message: error
                        }));
                    }
                    ws.send(JSON.stringify({
                        id: 'presenterResponse',
                        response: 'accepted',
                        Event: message.Event,
                        sdpAnswer: sdpAnswer
                    }));
                });
                break;

            case 'viewer':
                startViewer(sessionId, ws, message.sdpOffer, message.Event, function (error, sdpAnswer) {
                    if (error) {
                        return ws.send(JSON.stringify({
                            id: 'viewerResponse',
                            response: 'rejected',
                            Event: message.Event,
                            message: error
                        }));
                    }

                    ws.send(JSON.stringify({
                        id: 'viewerResponse',
                        response: 'accepted',
                        Event: message.Event,
                        sdpAnswer: sdpAnswer
                    }));
                });
                break;

            case 'stop':
                stop(sessionId, message.Event);
                break;

            case 'onIceCandidate':
                onIceCandidate(sessionId, message.Event, message.candidate);
                break;
            case 'terminate':
				{
					// var apiData = 'token=' + message.key + '&userId=' + message.user + '&eventId=' + message.Event;
					// performRequest('/api/Common/CanStopP2P', 'POST', apiData, function (result) {
					// 	if (result.status != 200) {
					// 		return ws.send(JSON.stringify({
					// 			id: 'presenterResponse',
					// 			response: 'rejected',
					// 			Event: message.Event,
					// 			message: result.error
					// 		}));
					// 	}
					// });
					stopPresenting(message.Event, message.userMode);
				}
            default:
                ws.send(JSON.stringify({
                    id: 'error',
                    Event: message.Event,
                    message: 'Invalid message ' + message
                }));
                break;
        }
    });
});

/*
 * Definition of functions
 */

// Recover kurentoClient for the first time.
function getKurentoClient(callback) {
    if (kurentoClient !== null) {
        return callback(null, kurentoClient);
    }

    kurento(argv.ws_uri, function (error, _kurentoClient) {
        if (error) {
            console.log("Could not find media server at address " + argv.ws_uri);
            return callback("Could not find media server at address" + argv.ws_uri
				+ ". Exiting with error " + error);
        }

        kurentoClient = _kurentoClient;
        callback(null, kurentoClient);
    });
}

function performRequest(endpoint, method, data, success) {
	var dataString = data;
	var headers = {};
    endpoint += '?' + data;
	var options = {
		hostname: 'www.kazastream.com',
		path: endpoint,
		port: 443,
		method: method,
		agent: false
	};
	var req = https.request(options, (res) => {
		console.log('statusCode:', res.statusCode);
		console.log('headers:', res.headers);
		res.on('data', (d) => {
			var resString = '' + d;
			success(JSON.parse(resString));
		});
	});
	req.end();
	req.on('error', (e) => {
		var customMessage = {
			status: 500,
			error: 'Some error for checking request'
		};
		success(JSON.parse(customMessage));
	});
}

// function restartEvent(eventId) {
// 	var presenterIndex = getIndexOfEventPresenter(eventId);
// 	presenter.splice(presenterIndex, 1);
// }


function startPresenter(sessionId, ws, sdpOffer, currentEvent, callback) {
    clearCandidatesQueue(sessionId);
    console.log('Checking current event: ' + currentEvent + ' presenter @185, found:', IsPresenterExitsForEvent(currentEvent));
    if (IsPresenterExitsForEvent(currentEvent)) {
        stop(sessionId, currentEvent);
        //return callback("Another user is currently acting as presenter in event: " + currentEvent + ", Try again later ...");
    }

    presenter.push({
        id: sessionId,
        Event: currentEvent,
        pipeline: null,
        webRtcEndpoint: null,
        rtpEndpoint: null
    });

    getKurentoClient(function (error, kurentoClient) {
        if (error) {
            stop(sessionId, currentEvent);
            return callback(error);
        }
        console.log('Checking current event: ' + currentEvent + ' presenter @204, found:', IsPresenterExitsForEvent(currentEvent));
        if (!IsPresenterExitsForEvent(currentEvent)) {
            stop(sessionId, currentEvent);
            return callback(noPresenterMessage);
        }

        kurentoClient.create('MediaPipeline', function (error, pipeline) {
            if (error) {
                stop(sessionId, currentEvent);
                return callback(error);
            }

            // if (presenter === null) {//old
            console.log('Checking current event: ' + currentEvent + ' presenter @217, found:', IsPresenterExitsForEvent(currentEvent));
            if (!IsPresenterExitsForEvent(currentEvent)) {
                stop(sessionId, currentEvent);
                return callback(noPresenterMessage);
            }
            var createdPresenter = getCurrentEventPresenter(currentEvent);
			(createdPresenter != null)
				? console.log('Getting current event: ' + currentEvent + ' presenter @222, found: true')
				: console.log('Getting current event: ' + currentEvent + ' presenter @222, found: false')
            createdPresenter.pipeline = pipeline;

            pipeline.create('WebRtcEndpoint', function (error, webRtcEndpoint) {

                if (error) {
                    stop(sessionId, currentEvent);
                    return callback(error);
                }

                console.log('Checking current event: ' + currentEvent + ' presenter @235, found:', IsPresenterExitsForEvent(currentEvent));
                if (!IsPresenterExitsForEvent(currentEvent)) {
                    stop(sessionId, currentEvent);
                    return callback(noPresenterMessage);
                }

                createdPresenter.webRtcEndpoint = webRtcEndpoint;

                if (candidatesQueue[sessionId]) {
                    while (candidatesQueue[sessionId].length) {
                        var candidate = candidatesQueue[sessionId].shift();
                        webRtcEndpoint.addIceCandidate(candidate);
                    }
                }

                webRtcEndpoint.on('OnIceCandidate', function (event) {
                    var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
                    ws.send(JSON.stringify({
                        id: 'iceCandidate',
                        Event: currentEvent,
                        candidate: candidate
                    }));
                });

                webRtcEndpoint.processOffer(sdpOffer, function (error, sdpAnswer) {
                    if (error) {
                        stop(sessionId, currentEvent);
                        return callback(error);
                    }
                    if (!IsPresenterExitsForEvent(currentEvent)) {
                        stop(sessionId, currentEvent);
                        return callback(noPresenterMessage);
                    }

                    callback(null, sdpAnswer);
                });

                webRtcEndpoint.gatherCandidates(function (error) {
                    if (error) {
                        stop(sessionId, currentEvent);
                        return callback(error);
                    }
                });
            });



        });

    });
}

function startViewer(sessionId, ws, sdpOffer, currentEvent, callback) {
    clearCandidatesQueue(sessionId);
    if (!IsPresenterExitsForEvent(currentEvent)) {
        stop(sessionId, currentEvent);
        return callback(noPresenterMessage);
    }
    var currentPresenter = getCurrentEventPresenter(currentEvent);
	(currentPresenter != null)
		? console.log('Getting current event: ' + currentEvent + ' presenter @294, found: true')
		: console.log('Getting current event: ' + currentEvent + ' presenter @294, found: false')
    currentPresenter.pipeline.create('WebRtcEndpoint', function (error, webRtcEndpoint) {
        if (error) {
            stop(sessionId, currentEvent);
            return callback(error);
        }

        var currentViewers = getCurrentEventViewers(currentEvent);
		(currentViewers != null)
			? console.log('Getting current event: ' + currentEvent + ' viewers @303 found: true')
			: console.log('Getting current event: ' + currentEvent + ' viewers @303 found: false')
        if (currentViewers != null && currentViewers.length > 0) {
            currentViewers.push({ webRtcEndpoint: webRtcEndpoint, ws: ws, id: sessionId, Event: currentEvent });
            var indexOfCurrentEventViewers = getIndexOfEventViewersInViewers(currentEvent);
            //viewers[indexOfCurrentEventViewers].eventViewers = viewerList;
        }
        else {
            var viewerList = [];
            viewerList.push({ webRtcEndpoint: webRtcEndpoint, ws: ws, id: sessionId, Event: currentEvent });
            viewers.push({ Event: currentEvent, eventViewers: viewerList });
        }

        console.log('Checking current event: ' + currentEvent + ' presenter @319, found: ', IsPresenterExitsForEvent(currentEvent));
        if (!IsPresenterExitsForEvent(currentEvent)) {
            stop(sessionId, currentEvent);
            return callback(noPresenterMessage);
        }

        //need to check that
        if (candidatesQueue[sessionId]) {
            while (candidatesQueue[sessionId].length) {
                var candidate = candidatesQueue[sessionId].shift();
                webRtcEndpoint.addIceCandidate(candidate);
            }
        }

        webRtcEndpoint.on('OnIceCandidate', function (event) {
            var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
            ws.send(JSON.stringify({
                id: 'iceCandidate',
                Event: currentEvent,
                candidate: candidate
            }));
        });

        webRtcEndpoint.processOffer(sdpOffer, function (error, sdpAnswer) {
            if (error) {
                stop(sessionId, currentEvent);
                return callback(error);
            }
            console.log('Checking current event: ' + currentEvent + ' presenter @347, found: ', IsPresenterExitsForEvent(currentEvent));
            if (!IsPresenterExitsForEvent(currentEvent)) {
                stop(sessionId, currentEvent);
                return callback(noPresenterMessage);
            }
            currentPresenter.webRtcEndpoint.connect(webRtcEndpoint, function (error) {
                if (error) {
                    stop(sessionId, currentEvent);
                    return callback(error);
                }
                console.log('Checking current event: ' + currentEvent + ' presenter @357, found: ', IsPresenterExitsForEvent(currentEvent));
                if (!IsPresenterExitsForEvent(currentEvent)) {
                    stop(sessionId, currentEvent);
                    return callback(noPresenterMessage);
                }
                callback(null, sdpAnswer);
                webRtcEndpoint.gatherCandidates(function (error) {
                    if (error) {
                        stop(sessionId, currentEvent);
                        return callback(error);
                    }
                });
            });
        });
    });

}
//need to modify that
function clearCandidatesQueue(sessionId) {
    if (candidatesQueue[sessionId]) {
        delete candidatesQueue[sessionId];
    }
}

function IsPresenterExitsForEvent(eventId) {

    if (presenter.length === 0)
        return false;
    else {
        for (var i = 0; i < presenter.length; i++) {
            if (presenter[i].Event === eventId)
                return true;
        }
    };
    return false;
}

function getCurrentEventPresenter(eventId) {

    if (presenter.length === 0)
        return null;
    else {
        for (var i = 0; i < presenter.length; i++) {
            if (presenter[i].Event === eventId)
                return presenter[i];
        }
    };
    return null;
}

function getCurrentEventViewers(eventId) {
    if (viewers.length === 0)
        return null;
    else {
        for (var i = 0; i < viewers.length; i++) {
            if (viewers[i].Event === eventId && i == (viewers.length - 1)) {
				console.log("Viewers found @ i: ", i);
				return viewers[i].eventViewers;
			}

        }
    }
    return null;
}

function getCurrentEventAndSessionViewer(sessionId, eventId) {
    var eventViewers = getCurrentEventViewers(eventId);
	(eventViewers != null)
		? console.log('Getting current event: ' + eventId + ' viewers @419, found: true')
		: console.log('Getting current event: ' + eventId + ' viewers @419, found: false')
    if (eventViewers != null) {
        for (var i = 0; i < eventViewers.length; i++) {
            if (eventViewers[i].id === sessionId)
                return eventViewers[i];
        }
    } return null;
}

function getSessionViewerByEventViewers(sessionId, eventViewers) {
	(eventViewers != null)
		? console.log('Getting current session: ' + sessionId + ' viewer using event viewers @432 , found: true')
		: console.log('Getting current session: ' + sessionId + ' viewer using event viewers @432 , found: false')
    if (eventViewers != null) {
        for (var i = 0; i < eventViewers.length; i++) {
            if (eventViewers[i].id === sessionId)
                return eventViewers[i];
        }
    } return null;
}

function IsViewerExitsForEvent(eventId) {
    var eventViewers = getCurrentEventViewers(eventId);
	(eventViewers != null)
		? console.log('Getting current event: ' + eventId + ' viewers found @445: true')
		: console.log('Getting current event: ' + eventId + ' viewers found @445: false')
    if (eventViewers == null) return false;
    else return true;
}

function getIndexOfEventViewersInViewers(eventId) {
    console.log('Getting current event ' + eventId + ' viewers index in all event viewers data @453');
    for (var i = 0; i < viewers.length; i++) {
        if (viewers[i].Event === eventId)
            return viewers.indexOf(viewers[i]);
    }
    return null;
}

function getIndexOfEventPresenter(eventId) {

    for (var i = 0; i < presenter.length; i++) {
		if (presenter[i].Event === eventId) {
			return presenter.indexOf(presenter[i]);
		}
	}
    return null;
}
//a bug there on closing browser not passing session and event
function stop(sessionId, eventId) {
    var currentPresenter = getCurrentEventPresenter(eventId);
	(currentPresenter != null)
		? console.log('Getting current event: ' + eventId + ' presenter @463, found : true')
		: console.log('Getting current event: ' + eventId + ' presenter @463, found : false')
    var currentViewers = getCurrentEventViewers(eventId);
    (currentViewers != null)
		? console.log('Getting current event: ' + eventId + ' viewers found @467 : true')
		: console.log('Getting current event: ' + eventId + ' viewers found @467: false');
    var eventViewersIndex = getIndexOfEventViewersInViewers(eventId);
	console.log('Getting current event ' + eventId + ' viewers index in all event viewers data, found @470 : ' + eventViewersIndex);
    if (presenter.length !== 0 && presenter.id == sessionId && currentPresenter != null) {
        for (var i = 0; i < currentViewers.length; i++) {
            var viewer = currentViewers[i];
            if (viewer.ws) {
                viewer.ws.send(JSON.stringify({
                    id: 'stopCommunication',
                    Event: eventId
                }));
            }
        }
        presenter[presenter.indexOf(currentPresenter)].pipeline.release();
        presenter.splice(presenter.indexOf(currentPresenter), 1);
        //deleting the set of viewers having same event id
        if (eventViewersIndex != null)
            viewers.splice(eventViewersIndex, 1);
    } else if (currentViewers) {
        for (var i = 0; i < currentViewers.length; i++) {
			if (currentViewers[i].id === sessionId) {
				currentViewers[i].webRtcEndpoint.release();
				break;
			}
        }
        if (eventViewersIndex != null)
            viewers.splice(eventViewersIndex, 1);
    }
    clearCandidatesQueue(sessionId);
}

function stopPresenting(eventId, mode) {
    if (mode === 'p') {
		var currentPresenter = getCurrentEventPresenter(eventId);
		if (currentPresenter) {
			var eventViewersIndex = getIndexOfEventViewersInViewers(eventId);
			if (eventViewersIndex != null) {
				currentPresenter.pipeline.release();
				var presenterIndex = getIndexOfEventPresenter(eventId);
				if (presenterIndex != null) {
					presenter.splice(presenterIndex, 1);
				}
				var currentViewers = getCurrentEventViewers(eventId);
				if (currentViewers) {
					for (var i = 0; i < currentViewers.length; i++) {
						currentViewers[i].webRtcEndpoint.release();

					}
					var currentViewersIndex = getIndexOfEventViewersInViewers(eventId);
					if (currentViewersIndex != null) {
						viewers.splice(currentViewersIndex, 1);
					}
				}
			}
		}
	}
}
//need to modify that
function onIceCandidate(sessionId, eventId, _candidate) {
	//check here if already processed the same candidate in getComplexType
    var candidate = kurento.getComplexType('IceCandidate')(_candidate);
    var currentPresenter = getCurrentEventPresenter(eventId);
	(currentPresenter != null)
		? console.log('Getting current event: ' + eventId + ' presenter, found @504: true')
		: console.log('Getting current event: ' + eventId + ' presenter, found @504: false')
    var currentViewers = getCurrentEventViewers(eventId);
	(currentViewers != null)
		? console.log('Getting current event: ' + eventId + ' viewers, found @508: true')
		: console.log('Getting current event: ' + eventId + ' viewers, found @508: false')

    var currentViewer = getSessionViewerByEventViewers(sessionId, currentViewers);
	(currentViewer != null)
		? console.log('Getting session ' + sessionId + ' viewer by using event viewers, found @514: true')
		: console.log('Getting session ' + sessionId + ' viewer by using event viewers, found @514: false')
    if (currentPresenter && currentPresenter.id === sessionId && currentPresenter.webRtcEndpoint) {
        console.info('Sending presenter candidate having session ' + sessionId + ' eventId: ' + eventId);
        currentPresenter.webRtcEndpoint.addIceCandidate(candidate);
    }
    else if (currentViewer && currentViewer.webRtcEndpoint) {
        console.info('Sending viewer candidate @520 having session ' + sessionId + ' eventId: ' + eventId);
        currentViewer.webRtcEndpoint.addIceCandidate(candidate);
    }
    else {
        console.info('Queueing candidate @525 having session ' + sessionId + ' eventId: ' + eventId);
        if (!candidatesQueue[sessionId]) {
            candidatesQueue[sessionId] = [];
        }
        candidatesQueue[sessionId].push(candidate);
    }
}
app.use(express.static(path.join(__dirname, 'static')));

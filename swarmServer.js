const WebSocket = require('ws');
const fs = require("fs");
const { v4: uuidv4 } = require('uuid');
const { setInterval } = require('timers');
var uuid = uuidv4();
path = require("path");
var configJson = {
    "defaultServerAddress": "",
    "defaultBootstrapServerURL": "Default Bootstrap Server URL",
    "defaultWebsocketServerPort": "787",
    "seedsServer": true,
    "reconnectToOriginalBootstrapServer": true,
    "serverName": ""
};
var serverAddress = "";
var bootstrapServerCurrentlyConnectedTo = {};
var unidentifiedSockets = [];
var identifiedSockets = [];
var serverUrls = [];
var messageHandledUuidHistory = [];
var numberFromSeed;
var bootstrapServerInterval;
var bootstrapServerIntervalRunning = false;
var portHasBeenForwarded = false;
var wsTestConnection;
var swarmUuid = "";
var hasAlreadyTestedPortForwarding = false;
var originalBootstrapServerAddress = "";
var serverIsOriginalBootstrapServer = false;
var ws;

fs.exists(path.join(process.cwd() + "/Config.json"), function (exists) {
    if (!exists) {
        fs.writeFile('Config.json', JSON.stringify(configJson, null, 2), function (err) {
            if (err) return console.log(err);
        });
    } else {
        var rawdata = fs.readFileSync('Config.json');
        configJson = JSON.parse(rawdata);
        if (configJson.defaultBootstrapServerURL != "Default Bootstrap Server URL" && !configJson.seedsServer) {
            numberFromSeed = 1;
            swarmUuid = "";
            connectToBootstrapServer(configJson.defaultBootstrapServerURL);
            openWebsocketServer();
        } else if (configJson.seedsServer) {
            if (configJson.defaultServerAddress != "") {
                serverAddress = configJson.defaultServerAddress;
                originalBootstrapServerAddress = configJson.defaultServerAddress;
            }
            numberFromSeed = 0;
            swarmUuid = uuidv4();
            serverIsOriginalBootstrapServer = true;
            openWebsocketServer();
        }
    }
});
//
//
function connectToBootstrapServer(ServerURL) {
    if (bootstrapServerIntervalRunning) {
        clearInterval(bootstrapServerInterval);
    }
    ws = new WebSocket(ServerURL);
    ws.onopen = function () {
        console.log("Connected To Bootstrap Server: " + ServerURL);
        ws.send(JSON.stringify({
            "action": "requestConnection",
            "originalSenderUuid": uuid,
            "connectingToUrl": ServerURL,
            "hasAlreadyEchoedThroughUuid": [],
            "messageUuid": uuidv4()
        }));
    }
    ws.onclose = function () {
        uuid = uuidv4();
        console.log(" ");
        console.log("Disconnected from Bootstrap Server: " + ServerURL);
        var newArray = [];
        for (let i = 0; i < serverUrls.length; i++) {
            if (bootstrapServerCurrentlyConnectedTo.serverAddress == serverUrls[i].serverAddress) {
                //
            } else {
                newArray.push(serverUrls[i]);
            }
        }
        serverUrls = newArray;
        if (numberFromSeed === 1) {
            var numberAtCurrentPosition = 0;
            for (let i = 0; i < serverUrls.length; i++) {
                if (serverUrls[i].numberFromSeed === 1) {
                    numberAtCurrentPosition++;
                }
            }
            if (numberAtCurrentPosition === 0) {
                numberFromSeed = 0;
                configJson.seedsServer = true;
                console.log(" ");
                if (configJson.reconnectToOriginalBootstrapServer) {
                    tryToReconnectToOriginalBootstrapServer();
                }
                console.log("I have become seed server");
            } else {
                var newServerArray = [];
                for (let i = 0; i < serverUrls.length; i++) {
                    if (serverUrls[i].numberFromSeed === 1) {
                        newServerArray.push(serverUrls[i]);
                    }
                }
                newServerArray.push({
                    "uuid": uuid,
                    "isMyUuid": true
                });
                for (let i = 0; i < newServerArray.length; i++) {
                    newServerArray[i].uuid = newServerArray[i].uuid.replace('{', '').replace('}', '').replace('}', '').replace(/\D/g, '');
                }
                var newArrangedServerUrlsArray = newServerArray.sort(function (a, b) { return parseFloat(a.uuid) - parseFloat(b.uuid) });
                if (newArrangedServerUrlsArray[0].isMyUuid) {
                    numberFromSeed = 0;
                    configJson.seedsServer = true;
                    console.log(" ");
                    console.log("I have become seed server");
                    if (configJson.reconnectToOriginalBootstrapServer) {
                        tryToReconnectToOriginalBootstrapServer();
                    }
                } else {
                    connectToBootstrapServer(newArrangedServerUrlsArray[0].serverAddress);
                }
            }
        } else {
            var newArrangedServerUrlsArray = serverUrls.sort(function (a, b) { return parseFloat(a.numberFromSeed) - parseFloat(b.numberFromSeed) });
            connectToBootstrapServer(newArrangedServerUrlsArray[0].serverAddress);
        }
        return;
    }
    ws.onmessage = function (evt) {
        try {
            var messageData = JSON.parse(evt.data);
        } catch (error) {
            return;
        }
        messageHand = false;
        for (let i = 0; i < messageHandledUuidHistory.length; i++) {
            if (messageHandledUuidHistory[i] == messageData.messageUuid) {
                messageHand = true;
            }
        }
        if (messageHand) {
            return;
        }
        if (messageHandledUuidHistory.length >= 21) {
            messageHandledUuidHistory.shift();
        }
        messageHandledUuidHistory.push(messageData.messageUuid);

        switch (messageData.action) {
            case "requestConnectionResponse":
                requestConnectionResponse();
                break;
            case "bootstrapServerPing":
                pingReceivedFromBootstrapServer();
                break;
            case "echo":
                sendEchoData(messageData, "identifiedSockets");
                break;
        }

        function requestConnectionResponse() {
            serverUrls = [];
            if (serverAddress === "" && messageData.echoConnectionUrl != "") {
                serverAddress = messageData.echoConnectionUrl + ":" + configJson.defaultWebsocketServerPort;
                console.log(" ");
                console.log("My Address Is " + serverAddress);
            }
            bootstrapServerCurrentlyConnectedTo = {
                "serverAddress": messageData.serverAddress,
                "uuid": messageData.originalSenderUuid,
                "ws": ws
            };

            sendToConnectedBootstrapServer({
                "action": "identifySelf",
                "originalSenderUuid": uuid,
                "serverAddress": serverAddress,
                "messageUuid": uuidv4(),
                "hasAlreadyEchoedThroughUuid": [],
                "timestamp": Date.now()
            });

            originalBootstrapServerAddress = messageData.originalBootstrapServerAddress;

            testPortForward(serverAddress);
            return;
        }

        function pingReceivedFromBootstrapServer() {
            if (messageData.numberFromSeed === 0) {
                numberFromSeed = messageData.hasAlreadyEchoedThroughUuid.length;
                swarmUuid = messageData.swarmUuid;
            }
            var serverInformationExists = false;
            if (messageData.originalSenderUuid != uuid) {
                for (let i = 0; i < serverUrls.length; i++) {
                    if (serverUrls[i].uuid === messageData.originalSenderUuid) {
                        serverUrls[i].timestamp = Date.now();
                        serverUrls[i].numberFromSeed = messageData.numberFromSeed;
                        serverUrls[i].connectedPeers = messageData.connectedPeers;
                        serverInformationExists = true;
                    }
                }
                if (!serverInformationExists) {
                    serverUrls.push({
                        "serverAddress": messageData.serverAddress,
                        "uuid": messageData.originalSenderUuid,
                        "numberFromSeed": messageData.numberFromSeed,
                        "connectedPeers": messageData.connectedPeers,
                        "timestamp": Date.now()
                    });
                }
            }
            sendToIdentifiedSockets(messageData);
            return;
        }
        return;
    }
    if (!configJson.seedsServer) {
        sendPingToBootstrapServer();
    }
    function sendPingToBootstrapServer() {
        bootstrapServerIntervalRunning = true;
        bootstrapServerInterval = setInterval(() => {
            if (portHasBeenForwarded || configJson.seedsServer) {
                sendToConnectedBootstrapServer({
                    "action": "socketPing",
                    "originalSenderUuid": uuid,
                    "hasAlreadyEchoedThroughUuid": [],
                    "serverAddress": serverAddress,
                    "numberFromSeed": numberFromSeed,
                    "connectedPeers": identifiedSockets.length,
                    "messageUuid": uuidv4(),
                    "timestamp": Date.now(),
                    "serverName": configJson.serverName
                });
            }
        }, 20000);
        return;
    }
    ws.onerror = function () {
        console.log(" ");
        console.log("Failed To Connect To Bootstrap Server URL");
        return;
    }
}
//
//
function openWebsocketServer() {
    console.clear();
    console.log("Unidentified Sockets: " + unidentifiedSockets.length);
    console.log("identified Sockets: " + identifiedSockets.length);
    console.log("Number From Seed: " + numberFromSeed);
    console.log("Number Of Other Servers In Swarm: " + serverUrls.length);
    console.log(" ");
    console.log("Servers In Swarm:");
    const WebSocket = require('ws');
    const wss = new WebSocket.Server({ port: configJson.defaultWebsocketServerPort });
    wss.on('connection', function connection(ws) {
        unidentifiedSockets.push({
            "remoteAddress": ws._socket.remoteAddress.split(":")[3],
            "remotePort": ws._socket.remotePort,
            "websocketConnection": ws
        });
        ws.on('message', function incoming(data) {
            try {
                var messageData = JSON.parse(data);
            } catch (error) {
                return;
            }

            if (messageData.messageUuid == undefined) {
                messageData.messageUuid = uuidv4();
            }

            messageHand = false;
            for (let i = 0; i < messageHandledUuidHistory.length; i++) {
                if (messageHandledUuidHistory[i] == messageData.messageUuid) {
                    messageHand = true;
                }
            }
            if (messageHand) {
                return;
            }
            if (messageHandledUuidHistory.length >= 21) {
                messageHandledUuidHistory.shift();
            }
            messageHandledUuidHistory.push(messageData.messageUuid);

            switch (messageData.action) {
                case "requestConnection":
                    requestConnection();
                    break;
                case "identifySelf":
                    identifyServerConnection();
                    break;
                case "socketPing":
                    socketPing();
                    break;
                case "echo":
                    sendEchoData(messageData, "bootstrapServer");
                    break;
            }

            function requestConnection() {
                if (serverAddress === "") {
                    serverAddress = messageData.connectingToUrl;
                    console.log(" ");
                    console.log("My Address Is " + serverAddress);
                    if (serverIsOriginalBootstrapServer) {
                        originalBootstrapServerAddress = serverAddress;
                    }
                }

                ws.send(JSON.stringify({
                    "action": "requestConnectionResponse",
                    "originalSenderUuid": uuid,
                    "echoConnectionUrl": "ws://" + ws._socket.remoteAddress.split(":")[3],
                    "serverAddress": serverAddress,
                    "originalBootstrapServerAddress": originalBootstrapServerAddress,
                    "hasAlreadyEchoedThroughUuid": [],
                    "messageUuid": uuidv4()
                }));

                var newArray = [];
                for (let i = 0; i < unidentifiedSockets.length; i++) {
                    if (unidentifiedSockets[i].remoteAddress == ws._socket.remoteAddress.split(":")[3] && unidentifiedSockets[i].remotePort == ws._socket.remotePort) {
                        //
                    } else {
                        newArray.push(unidentifiedSockets[i]);
                    }
                }
                unidentifiedSockets = newArray;
                identifiedSockets.push({
                    "connectionToUuid": messageData.originalSenderUuid,
                    "websocketConnection": ws
                });
                console.log("Connected To: " + messageData.originalSenderUuid);
                return;
            }

            function identifyServerConnection() {
                return;
            }

            function socketPing() {
                var serverInformationExists = false;
                if (messageData.originalSenderUuid != uuid) {
                    for (let i = 0; i < serverUrls.length; i++) {
                        if (serverUrls[i].uuid === messageData.originalSenderUuid) {
                            serverUrls[i].timestamp = Date.now();
                            serverUrls[i].numberFromSeed = messageData.numberFromSeed;
                            serverUrls[i].connectedPeers = messageData.connectedPeers;
                            serverInformationExists = true;
                        }
                    }
                    if (!serverInformationExists) {
                        serverUrls.push({
                            "serverAddress": messageData.serverAddress,
                            "uuid": messageData.originalSenderUuid,
                            "numberFromSeed": messageData.numberFromSeed,
                            "connectedPeers": messageData.connectedPeers,
                            "timestamp": Date.now()
                        });
                    }
                }
                if (!configJson.seedsServer) {
                    sendToConnectedBootstrapServer(messageData);
                }
                messageData.action = "bootstrapServerPing";
                sendToIdentifiedSockets(messageData);
                return;
            }
            return;
        });
        ws.on('close', function connection() {
            var wsRemoteAddressDisconnectionInformation = {};
            var newArray = [];
            for (let i = 0; i < identifiedSockets.length; i++) {
                if (identifiedSockets[i].websocketConnection._socket.remoteAddress.split(":")[3] == ws._socket.remoteAddress.split(":")[3]) {
                    if (identifiedSockets[i].websocketConnection._socket.remotePort == ws._socket.remotePort) {
                        wsRemoteAddressDisconnectionInformation.connectionToUuid = identifiedSockets[i].connectionToUuid;
                    } else {
                        newArray.push(identifiedSockets[i]);
                    }
                }
            }
            identifiedSockets = newArray;
            var newArray = [];
            for (let x = 0; x < serverUrls.length; x++) {
                if (serverUrls[x].uuid == wsRemoteAddressDisconnectionInformation.connectionToUuid) {
                    //
                } else {
                    newArray.push(serverUrls[x]);
                }
            }
            serverUrls = newArray;
            var newArray = [];
            for (let i = 0; i < unidentifiedSockets.length; i++) {
                if (unidentifiedSockets[i].remoteAddress == ws._socket.remoteAddress.split(":")[3] && unidentifiedSockets[i].remotePort == ws._socket.remotePort) {

                } else {
                    newArray.push(unidentifiedSockets[x]);
                }
            }
            unidentifiedSockets = newArray;
            if (wsRemoteAddressDisconnectionInformation.connectionToUuid == undefined) {
                console.log(" ");
                console.log("Connection Closed");
            } else {
                console.log(" ");
                console.log("Connection Closed: " + wsRemoteAddressDisconnectionInformation.connectionToUuid);
            }
            return;
        });
    });

    setInterval(() => {
        console.clear();
        if (serverAddress != "") {
            console.log("My Address Is " + serverAddress);
        }
        console.log("Swarm uuid: " + swarmUuid);
        // console.log("Original Bootstrap Server Address: " + originalBootstrapServerAddress);
        console.log("Unidentified Sockets: " + unidentifiedSockets.length);
        console.log("identified Sockets: " + identifiedSockets.length);
        console.log("Number From Seed: " + numberFromSeed);
        console.log("Number Of Other Servers In Swarm: " + serverUrls.length);
        console.log(" ");
        console.log("Servers In Swarm:");
        var newArrangedServerUrlsArray = serverUrls.sort(function (a, b) { return parseFloat(a.numberFromSeed) - parseFloat(b.numberFromSeed) });
        for (let i = 0; i < newArrangedServerUrlsArray.length; i++) {
            console.log(" ");
            console.log("Server Uuid: " + newArrangedServerUrlsArray[i].uuid);
            console.log((newArrangedServerUrlsArray[i].numberFromSeed == undefined) ? "Number From Seed: Hasn't Yet Been Specified" : "Number From Seed: " + newArrangedServerUrlsArray[i].numberFromSeed);
        }
        if (portHasBeenForwarded || configJson.seedsServer) {
            sendToIdentifiedSockets({
                "action": "bootstrapServerPing",
                "originalSenderUuid": uuid,
                "hasAlreadyEchoedThroughUuid": [],
                "serverAddress": serverAddress,
                "numberFromSeed": numberFromSeed,
                "connectedPeers": identifiedSockets.length,
                "messageUuid": uuidv4(),
                "timestamp": Date.now(),
                "serverName": configJson.serverName,
                "swarmUuid": swarmUuid
            });
        }
        var newArray = [];
        for (let i = 0; i < serverUrls.length; i++) {
            if (serverUrls[i].timestamp + 25000 <= Date.now()) {
            } else {
                newArray.push(serverUrls[i]);
            }
        }
        serverUrls = newArray;
    }, 20000);
    return;
}

function sendToIdentifiedSockets(messageData) {
    messageData.hasAlreadyEchoedThroughUuid.push(uuid);
    for (let i = 0; i < identifiedSockets.length; i++) {
        var hasAlreadyEchoedTo = false;
        for (let x = 0; x < identifiedSockets.length; x++) {
            if (messageData.hasAlreadyEchoedThroughUuid[i] == identifiedSockets[x].connectionToUuid) {
                hasAlreadyEchoedTo = true;
            }
        }
        if (!hasAlreadyEchoedTo) {
            identifiedSockets[i].websocketConnection.send(JSON.stringify(messageData));
        }
    }
    return;
}

function sendToConnectedBootstrapServer(messageData) {
    messageData.hasAlreadyEchoedThroughUuid.push(uuid);
    var hasAlreadyEchoedTo = false;
    for (let x = 0; x < identifiedSockets.length; x++) {
        if (messageData.hasAlreadyEchoedThroughUuid[x] == bootstrapServerCurrentlyConnectedTo.uuid) {
            hasAlreadyEchoedTo = true;
        }
    }
    if (!hasAlreadyEchoedTo && !configJson.seedsServer) {
        bootstrapServerCurrentlyConnectedTo.ws.send(JSON.stringify(messageData));
    }
    return;
}

function sendEchoData(messageData) {
    sendToIdentifiedSockets(messageData);
    if (!configJson.seedsServer) {
        sendToConnectedBootstrapServer(messageData);
    }
    for (let i = 0; i < unidentifiedSockets.length; i++) {
        unidentifiedSockets[i].websocketConnection.send(JSON.stringify(messageData.data));
    }
    return;
}

function testPortForward(serverAddress) {
    if (hasAlreadyTestedPortForwarding) {
        //
    } else {
        hasAlreadyTestedPortForwarding = true;
        wsTestConnection = new WebSocket(serverAddress);
        wsTestConnection.onopen = function () {
            portHasBeenForwarded = true;
            console.log(" ");
            console.log("Thank You For Port Forwarding");
            setTimeout(() => {
                wsTestConnection.close();
            }, 1000);
        }
        wsTestConnection.onerror = function (error) {
            console.log(" ");
            console.log("Please Port Forward");
            console.log("Your Server Will Not Show Up On The Network Until You Do");
            console.log("Your Port Is Set To " + configJson.defaultWebsocketServerPort);
            portHasBeenForwarded = false;
        }
    }
    return;
}

function tryToReconnectToOriginalBootstrapServer() {
    console.log("Trying To Connect To Original Bootstrap Server");
    if (originalBootstrapServerAddress != "") {
        var testInterval = setInterval(() => {
            var wsTestConnection = new WebSocket(originalBootstrapServerAddress);
            wsTestConnection.onopen = function () {
                clearInterval(testInterval);
                configJson.seedsServer = false;
                wsTestConnection.close();
                connectToBootstrapServer(originalBootstrapServerAddress);
            }
            wsTestConnection.onerror = function () {
            }
        }, 60000);
    }
}

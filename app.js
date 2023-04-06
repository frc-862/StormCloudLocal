var usbmux = require('usbmux');

var Adb = require('adbkit');
const client = Adb.createClient();

var socketIOClient = undefined;

var {spawn} = require('child_process');
const net = require('net');
const express = require('express');
const axios = require('axios');

const {AsyncNedb} = require('nedb-async');
const matches = new AsyncNedb({filename: 'data/matches.db', autoload: true});
const documents = new AsyncNedb({filename: 'data/documents.db', autoload: true});
const schemas = new AsyncNedb({filename: 'data/schemas.db', autoload: true});
const analysises = new AsyncNedb({filename: 'data/analysises.db', autoload: true});
const rankings = new AsyncNedb({filename: 'data/rankings.db', autoload: true});
const teams = new AsyncNedb({filename: 'data/teams.db', autoload: true});
const analysisSets = new AsyncNedb({filename: 'data/analysisSets.db', autoload: true});

var sendSettings = {
    matches: true,
    documents: true,
    schemas: true,
    analysises: true,
    teams: true,
    rankings: true
}



const app = express();
const server = require('http').createServer(app);
const { Server } = require('socket.io');
var socketPort = 3001;
const io = new Server(socketPort, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
      }
});


var expressPort = 3000;




var usbSettings = {
    iosEnable: true,
    androidEnable: true
}

io.on('connection', async (socket) => {

    socket.emit('allSendback', sendSettings);
    socket.emit('report', {
        documents: await documents.asyncFind({})
    })

    socket.on('configure', (data) => {

        usbSettings[data.setting] = data.value;
    });
    socket.on('sendback', (data) => {
        sendSettings[data.item] = data.status;
    })
    socket.on('exportData', async (data) => {
        if(data == "documents"){
            var docs = await documents.asyncFind({});
            socket.emit('export', JSON.stringify(docs));
        }
    })
    socket.on('clear', async (data) => {
        if(data == "Android"){
            androidChild = undefined;
            androidChildSuccessful = false;
            socketLog("Android: Cleared", "#f54242")
        }
    });
});

function socketLog(message, color){
    io.emit('log', {message: message, color: color});
}

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/view.html');
});

app.listen(expressPort, () => {
    console.log('Express listening on port ' + expressPort);
});



// var relay = new usbmux.Relay(22, 2222)
//   .on('error', function(err) {})
//   .on('ready', function(udid) {
//     console.log('Relay is ready for device ' + udid)
//   });

// var listener = new usbmux.createListener()
//   .on('error', function(err) {})
//   .on('attached', function(udid) {
//     console.log('Device ' + udid + ' was attached');


//   })
//   .on('detached', function(udid) {});



async function getSendObject(){
    var sendObject = {};
    if(sendSettings.matches){
        sendObject.matches = await matches.asyncFind({});

        sendObject.matches = sendObject.matches.sort((a,b) => a.matchNumber - b.matchNumber);
    }
    if(sendSettings.documents){
        sendObject.documents = await documents.asyncFind({});
    }
    if(sendSettings.schemas){
        sendObject.schemas = await schemas.asyncFind({});
    }
    if(sendSettings.analysises){
        sendObject.analysises = await analysises.asyncFind({});

        // should be in format: {team: {}}
    }
    if(sendSettings.rankings){
        sendObject.rankings = await rankings.asyncFind({});
    }
    if(sendSettings.teams){
        sendObject.teams = await teams.asyncFind({});
    }

    return sendObject;
}




async function handleIncomingData(data){
    var parsedData = JSON.parse(data);
    parsedData["matches"].forEach(function(match){
        documents.find({Identifier: match.Identifier}, function(err, docs){
            if(docs.length == 0){
                documents.insert(match);
                socketLog("Inserted new match: " + match.Identifier, "#42f5c2")
            }
            else{
                documents.update({Identifier: match.Identifier}, match);
                socketLog("Updated match: " + match.Identifier, "#42f5c2")
            }
        });
    });
    var docs = await documents.asyncFind({});
    io.emit('report', {
        documents: await documents.asyncFind({})
    })
}









function beginiOSTracking(){
    try{
        var listener = new usbmux.createListener()
        .on('error', function(err) {
            io.emit("iosDevice", false);
        })
        .on('attached', function(udid) {
            io.emit("iosDevice", true);
            if(usbSettings.iosEnable == false) return;
            
            usbmux.getTunnel(5050)
            .then(async function(tunnel) {
                // tunnel is just a net.Socket connection to the device port
                // you can write / .on('data') it like normal
                socketLog("iOS: Established tunnel", "#42b0f5")
                var messageToSend = JSON.stringify((await getSendObject()));
                tunnel.write('greetings');
                var messageSendLength = messageToSend.length;
                var fullMessage = '';
                var sendMode = false;
                
                tunnel.on('data', function(data) {
                    var dataString = data.toString();
                    if(!sendMode){
                        if(!dataString.startsWith("END")){
                            fullMessage += data;
                            
                        }else{
                            socketLog("iOS: Full message: " + fullMessage, "#42b0f5");
                            handleIncomingData(fullMessage);
                            fullMessage = '';
                            sendMode = true;
                        }
                    }

                    if(sendMode){
                        if(messageToSend == ""){
                            tunnel.write("END".padEnd(300, '\0'));

                            io.emit('progress', 100);
                            
                        }else{
                            tunnel.write(messageToSend.substring(0, 300).padEnd(300, '\0'));
                            messageToSend = messageToSend.substring(300);

                            io.emit('progress', 100-(messageToSend.length/messageSendLength)*100);
                        }
                    }else{
                        tunnel.write(''.padEnd(300, '\0'));
                        // clear out previous data in tunnel
                        // tunnel.write(''.padEnd(300, '\0'));

                    }
                    
                });
    
    
            })
            .catch(function(err) {
                console.err(err);
                // "Tunnel failed, Err #3: Port isn't available or open"
            });
        })
        .on('detached', function(udid) {
            io.emit("iosDevice", false);
        });
    
        
        
    }
    catch(e){
    
    }
}

var androidChild = undefined;
var androidChildSuccessful = false;
var androidSocketConnection = undefined;

async function setupPortForward(){

    androidChild = spawn('adb', ['forward', 'tcp:5051', 'tcp:5050']);
    androidChild.stdout.on('data', (data) => {
        socketLog(`Android: ${data}`, "#f54242");
        
    });
    androidChild.on('exit', async (code) => {
        
        socketLog(`Android: child process exited with code ${code}`, "#f54242");
        if(code == 0){
            if(usbSettings.androidEnable == false) return;
            androidChildSuccessful = true;
            androidSocketConnection = net.createConnection(5051);
            var messageToSend = JSON.stringify((await getSendObject()));
            

            var messageSendLength = messageToSend.length;

            var finalMessage = '';
            var sendMode = false;
            androidSocketConnection.write('greetings');
            androidSocketConnection.on('data', (data) => {
                // convert buffer to string

                var string = data.toString();
                if(!sendMode){
                    if(!string.startsWith("END")){
                        finalMessage += string;
                        
                    }else{
                        socketLog("Android Full Message: " + finalMessage, "#f54242");
                        handleIncomingData(finalMessage);
                        
                        
                        finalMessage = '';
                        sendMode = true;
                    }
                }

                if(sendMode){
                    if(messageToSend == ""){
                        androidSocketConnection.write("END".padEnd(300, '\0'));
                        androidChild = undefined;
                        androidChildSuccessful = false;

                        io.emit('progress', 100);

                        
                    }else{
                        androidSocketConnection.write(messageToSend.substring(0, 300).padEnd(300, '\0'));
                        messageToSend = messageToSend.substring(300);

                        io.emit('progress', 100-(messageToSend.length/messageSendLength)*100);
                    }
                }else{
                    androidSocketConnection.write(''.padEnd(300, '\0'));
                    // clear out previous data in tunnel
                    // tunnel.write(''.padEnd(300, '\0'));

                }
                
                
            });

        }else{
            androidChild = undefined;
            androidChildSuccessful = false;
        }
        
    })

}

async function beginAndroidTracking(){

    client.trackDevices()
    .then(function(tracker) {
        tracker.on('add', function(device) {
            io.emit("androidDevice", true);
            if(androidChild == undefined && androidChildSuccessful == false)
                setupPortForward();
        })
        tracker.on('remove', function(device) {
            io.emit("androidDevice", false);
        });
        tracker.on('end', function() {
            io.emit("androidDevice", false);
        });
    })
    
}

beginAndroidTracking();
beginiOSTracking();
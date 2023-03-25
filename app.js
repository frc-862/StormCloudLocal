var usbmux = require('usbmux');

var Adb = require('adbkit');
const client = Adb.createClient();

var socketIOClient = undefined;

var {spawn} = require('child_process');
const net = require('net');
const express = require('express');
const axios = require('axios');

const nedb = require('nedb');
const matches = new nedb({filename: 'data/matches.db', autoload: true});
const schemas = new nedb({filename: 'data/schemas.db', autoload: true});
const analysises = new nedb({filename: 'data/analysises.db', autoload: true});



const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);

var expressPort = 3000;
var socketPort = 3001;

server.listen(socketPort, () => {
    console.log('Socket listening on port ' + socketPort);
});

var usbSettings = {
    iosEnable: true,
    androidEnable: true
}

io.on('connection', (socket) => {
    socket.on('configure', (data) => {

        usbSettings[data.setting] = data.value;
    });
});


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






function handleIncomingData(data){
    var parsedData = JSON.parse(data);
    parsedData["matches"].forEach(function(match){
        matches.find({Identifier: match.Identifier}, function(err, docs){
            if(docs.length == 0){
                matches.insert(match);
                console.log("Inserted new match: " + match.Identifier)
            }
            else{
                matches.update({Identifier: match.Identifier}, match);
                console.log("Updated match: " + match.Identifier)
            }
        });
    });
    matches.find({}, function(err, docs){
        io.emit('matches', docs);
    });
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
            .then(function(tunnel) {
                // tunnel is just a net.Socket connection to the device port
                // you can write / .on('data') it like normal
                console.log("Established tunnel")
                
                tunnel.write('greetings');
                var fullMessage = '';
                tunnel.on('data', function(data) {
                    console.log("Received data: " + data);
                    if(data != "END"){
                        fullMessage += data;
                        
                    }else{
                        console.log("Full message: " + fullMessage);
                        handleIncomingData(fullMessage);
                        fullMessage = '';
                    }
                    tunnel.write('ok, and?');
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
        console.log(`Android: ${data}`);
        
    });
    androidChild.on('exit', (code) => {
        
        console.log(`Android: child process exited with code ${code}`);
        if(code == 0){
            if(usbSettings.androidEnable == false) return;
            androidChildSuccessful = true;
            androidSocketConnection = net.createConnection(5051);
            var finalMessage = '';
            androidSocketConnection.on('data', (data) => {
                // convert buffer to string
                var string = data.toString();
                console.log("Android Data: " + string);
                if(!string.startsWith("END")){
                    finalMessage += string;
                    androidSocketConnection.write("ok, and?");
                }else{
                    console.log("Android Full Message: " + finalMessage);
                    handleIncomingData(finalMessage);
                    
                    androidChild = undefined;
                    androidChildSuccessful = false;
                    finalMessage = '';
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
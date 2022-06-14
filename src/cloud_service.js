// MIT License
//
// Copyright (c) 2012 Universidad Politécnica de Madrid
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

// This file is borrowed from lynckia/licode with some modifications.

/*global require, __dirname, console, process*/
'use strict';

var express = require('express'),
  spdy = require('spdy'),
  bodyParser = require('body-parser'),
  errorhandler = require('errorhandler'),
  morgan = require('morgan'),
  fs = require('fs'),
  https = require('https'),
  restClient = require('./restClient');

var app = express();

var clusters = {},
    restClients = {},
    conferences = {};

// app.configure ya no existe
app.use(errorhandler());
app.use(morgan('dev'));
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));
app.disable('x-powered-by');

app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, GET, PUT, PATCH, OPTIONS, DELETE');
  res.header('Access-Control-Allow-Headers', 'origin, content-type');
  res.header('Strict-Transport-Security', 'max-age=1024000; includeSubDomain');
  res.header('X-Content-Type-Options', 'nosniff');
  if (req.method == 'OPTIONS') {
    res.send(200);
  } else {
    next();
  }
});

app.get('/createConference/', function(req, res) {
  var conferenceID = Math.round(Math.random() * 100000000000000000000) + '';
  res.send(conferenceID);
});

//randomly select cluster in the region
var selectCluster = function (region) {
  const keys = Object.keys(region);
  const random = Math.floor(Math.random() * keys.length);
  
  console.log(random, keys[random]);
  return keys[random];
}

//Check if cascading is needed
var checkEventCascading = function (conferenceID, region, clusterID) {
  //var keys = Object.keys(conferences[conferenceID]).filter(function(re) { return re !== region; })
  var keys = Object.keys(conferences[conferenceID]);
  console.log("check event cascading regions:", keys);
  keys.forEach((allregion) => {
    var clusters = Object.keys(conferences[conferenceID][allregion]);
    if (clusters.length < 1) {
      console.log("No cluster in this region serve for this conference:", conferenceID);
    } else {
      clusters.forEach ((cluster) => {
        console.log("cluster is:", cluster, " clusterID:", clusterID);
        if(cluster !== clusterID) {
          if (conferences[conferenceID][allregion][cluster].eventbridgeip) {
            var options = {
                room: conferenceID,
                targetCluster: cluster,
                selfCluster: clusterID,
                evIP: conferences[conferenceID][allregion][cluster].eventbridgeip,
                mediaIP: conferences[conferenceID][allregion][cluster].mediabridgeip,
                mediaPort: conferences[conferenceID][allregion][cluster].mediabridgeport,
                evPort: conferences[conferenceID][allregion][cluster].eventbridgeport
              }

              console.log("cascading options are:", options);
              restClients[clusterID].startEventCascading(conferenceID, options, function(roomID){
                console.log("start cascading successfully");
              }, function(error){
                console.log("start cascading fail with error:", error);
              });
          } else {
            console.log("restClients get bridge info for cluster:", cluster);
            restClients[cluster].getBridges(conferenceID, clusterID, function(bridgeInfo) {
              var info = JSON.parse(bridgeInfo);
              console.log("bridge info:", info, " evip:", info.eventbridgeip);
              var options = {
                room: conferenceID,
                targetCluster: cluster,
                selfCluster: clusterID,
                evIP: info.eventbridgeip,
                mediaIP: info.mediabridgeip,
                mediaPort: info.mediabridgeport,
                evPort: info.eventbridgeport
              }

              console.log("cascading options are:", options);
              restClients[clusterID].startEventCascading(conferenceID, options, function(roomID){
                console.log("start cascading successfully");
              }, function(error){
                console.log("start cascading fail with error:", error);
              });
            }, function (error) {
            });
          }
        }
      })
    }
  });
}

var sendTokenRequest = function (clusterID, req, res) {
  var region = req.body.region,
      conferenceID = req.body.room,
      username = req.body.user,
      role = req.body.role;

  var preference = {isp: 'isp', region: 'region'};

  restClients[clusterID].createToken(conferenceID, username, role, preference, function(token) {
    res.send(token);
  }, function(err) {
    res.send(err);
  });

  setTimeout(() => {
    checkEventCascading(conferenceID, region, clusterID);
    }, 3000);

}

app.post('/createToken/', function(req, res) {
  var region = req.body.region,
      conferenceID = req.body.room,
      username = req.body.user,
      role = req.body.role;

  if (!conferenceID) {
    var conferenceID = Math.round(Math.random() * 1000000000000000000) + '';
  }

  console.log("join conference and conferences:", conferences);
  if (conferences[conferenceID] && conferences[conferenceID][region]) {
    var preference = {isp: 'isp', region: 'region'};
    var clusterID = selectCluster(conferences[conferenceID][region]);
    restClients[clusterID].createToken(conferenceID, username, role, preference, function(token) {
      res.send(token);
    }, function(err) {
      res.send(err);
    });
  } else {
    if (!conferences[conferenceID]) {
      conferences[conferenceID] = {};
    }
    
    if (clusters[region]) {
      if (!conferences[conferenceID][region]) {
        conferences[conferenceID][region] = {};
      }
      
      var clusterID = selectCluster(clusters[region]);
      console.log("clusters are:", clusters);
      console.log("clusterID:", clusterID, " region:", region);
      console.log("restclients are:", restClients);

      var options = {
        _id: conferenceID,
    };
      if (!conferences[conferenceID][region][clusterID]) {
        conferences[conferenceID][region][clusterID] = {};
      }
      
      restClients[clusterID].getRoom(conferenceID, function (rooms) {
        sendTokenRequest(clusterID, req, res);
      }, function(error) {
        restClients[clusterID].createRoom(conferenceID, options, function(room){
          console.log("create room succeed with info:", room);
          sendTokenRequest(clusterID, req, res);
        }, function(error){
          res.send(error);
        })
      });
    } else {
      res.send('Conference is not avaiable');
    }
  }
});

app.post('/registerCluster/', function(req, res) {
  var region = req.body.region,
    clusterID = req.body.clusterID,
    info = req.body.info;
    console.log("register cluster with info:", info, " cluster:", clusterID, " region:", region);
  if (!clusters[region]) {
    clusters[region] = {};
  }
  console.log("clusters are:", clusters);
  if (!clusters[region][clusterID]) {
    clusters[region][clusterID] = {};
  }
  clusters[region][clusterID].restserver = info;
  var spec = {
    key: info.servicekey,
    service: info.serviceid,
    url: info.resturl,
    rejectUnauthorizedCert: false
  }
  restClients[clusterID] = restClient(spec);
  res.send('ok')
});

app.post('/updateCapacity/', function(req, res) {
  var region = req.body.region,
    clusterID = req.body.clusterID,
    info = req.body.info;
    console.log("update cluster with info:", info, " cluster:", clusterID, " region:", region);
  if (!clusters[region]) {
    clusters[region] = {};
  }

  if (!clusters[region][clusterID]) {
    clusters[region][clusterID] = {};
  }

  if(!clusters[region][clusterID].capacity) {
    clusters[region][clusterID].capacity = [];
  }

  console.log("clusters are:", JSON.stringify(clusters));
  if (info.action === 'add') {
    clusters[region][clusterID].capacity.push(info.capacity);
  } else {
    clusters[region][clusterID].capacity.pop(info.capacity);
  }
  res.send('ok');
});

spdy.createServer({
  spdy: {
    plain: true
  }
}, app).listen(3010, (err) => {
  if (err) {
    console.log('Failed to setup plain server, ', err);
    return process.exit(1);
  }
});

var cipher = require('./cipher');
cipher.unlock(cipher.k, 'cert/.woogeen.keystore', function cb(err, obj) {
  if (!err) {
    spdy.createServer({
      pfx: fs.readFileSync('cert/certificate.pfx'),
      passphrase: obj.sample
    }, app).listen(3014, (error) => {
      if (error) {
        console.log('Failed to setup secured server: ', error);
        return process.exit(1);
      }
    });
  }
  if (err) {
    console.error('Failed to setup secured server:', err);
    return process.exit();
  }
});

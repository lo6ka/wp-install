var ssh2 = require('ssh2');
var request = require('request');
var fs = require('fs');
var Client = ssh2.Client;
var Server = require('../models/server');

module.exports = {

    createWPServerOnVultr: function(req, res, next, options){

        request({
            url: 'https://api.vultr.com/v1/server/create?api_key=' + options.apiKey,
            form: {
                DCID: options.DCID,
                OSID: options.OSID,
                VPSPLANID: options.VPSPLANID
            },
            method: 'POST'
        }, function(err, response, body){

            // check if req is done
            if(!err && response.statusCode !== 200) {
                return console.log(err);
            }

            res.redirect('/');

            // create server db record
            var server = Server();
            server.user = 'root';
            server.ready = false;

            // get server id
            var serverId = JSON.parse(body).SUBID;

            server.vulrt_id = serverId;

            // check when server is ready for ssh connection
            var timer = setInterval(function(){

                // get server info
                request({
                    url: 'https://api.vultr.com/v1/server/list?api_key=' + options.apiKey + '&SUBID=' + serverId,
                    method: 'GET'
                }, function(err, response, body){

                    // check if req is done
                    if(!err && response.statusCode !== 200) {
                        return console.log(err);
                    }

                    var obj = JSON.parse(body);

                    server.status = 'Creating';
                    server.save();

                    // check if server ready
                    if(obj.power_status === 'running' && obj.server_state === 'ok' && obj.status === 'active' && obj.main_ip && obj.default_password){

                        server.ip = obj.main_ip;
                        server.password = obj.default_password;
                        server.status = 'Installing software';
                        server.save();

                        console.log('Trying to connect...');

                        // kill timer
                        clearInterval(timer);

                        // ssh connection
                        var conn = new Client();
                        conn.on('ready', function() {
                            console.log('Client :: ready');

                            // transfer sh script to server root folder
                            conn.sftp(function(err, sftp) {
                                if (err) {
                                    server.status = 'Error';
                                    server.save();
                                    return console.log(err);
                                }

                                // creating file stream
                                var readStream = fs.createReadStream( "./sh/baseserv.sh" );
                                var writeStream = sftp.createWriteStream( "/root/baseserv.sh" );

                                writeStream.on('close', function () {
                                    console.log( "File transferred" );
                                    sftp.end();

                                    // execute file
                                    conn.exec('cd /root && sh baseserv.sh', function(err, stream){

                                        if (err) {
                                            return console.log(err);
                                        }

                                        stream.on('close', function(code, signal) {

                                            console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);
                                            var command = 'virtualmin create-domain --domain "$(hostname -I)' +
                                                '" --user "' + options.serverUser +
                                                '" --pass "' + options.serverPassword +
                                                '" --desc "' + options.description +
                                                '" --unix --dir --webmin --web --mail --mysql --limits-from-plan' +
                                                ' --mysql-pass "' + options.serverPassword + '" && ' +
                                                'echo \'{"cmd":"install","application":"wordpress",' +
                                                '"user":"' + options.serverUser + '",'+
                                                '"email":"' + options.adminEmail + '",'+
                                                '"login":"' + options.adminUsername + '",'+
                                                '"sitetitle":"' + options.title + '",'+
                                                '"sitetagline":"' + options.description + '",'+
                                                '"passwd":"' + options.adminPassword + '"}\' | /usr/local/installatron/installatron';

                                            stream.end();

                                            conn.exec(command, function(err, stream){

                                                if (err) {
                                                    return console.log(err);
                                                }

                                                stream.on('close', function(code, signal){

                                                    server.status = 'Ready';
                                                    server.ready = true;
                                                    server.save();
                                                    stream.end();

                                                    return conn.end();
                                                }).on('data', function(data) {

                                                    console.log('STDOUT: ' + data);

                                                }).stderr.on('data', function(data) {

                                                    console.log('STDERR: ' + data);

                                                });

                                            });

                                            //return res.send('Server is ready');

                                        }).on('data', function(data) {

                                            console.log('STDOUT: ' + data);

                                        }).stderr.on('data', function(data) {

                                            console.log('STDERR: ' + data);

                                        });

                                    });
                                });
                                // transfer file
                                readStream.pipe( writeStream );
                            });

                        }).on('error', function(err) {
                            console.log(err);
                            server.status = 'Error';
                            server.save();
                        }).connect({
                            host: obj.main_ip,
                            port: 22,
                            username: 'root',
                            password: obj.default_password,
                            readyTimeout: 999999
                        });

                    }

                });

            }, 2000);

        });
        console.log('Error? :(');
    }
};
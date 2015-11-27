var ssh2 = require('ssh2');
var request = require('request');
var fs = require('fs');
var Client = ssh2.Client;
var Server = require('../models/server');

module.exports = {

    /*
    * createServer() - creating server o vulrt.com
    * prepareServer() - installing software via ssh
    * addServer() - save server to DB
    * createDomain() - create virtualmin domain
    * installWordpress() - installing Wordpress using installatron plugin
    * */

    createServer: function(options, callback){

        if(!options.apiKey || !options.DCID || !options.OSID || !options.VPSPLANID) {
            return callback(new Error('Some parameters are missing!'));
        }

        request({
            url: 'https://api.vultr.com/v1/server/create?api_key=' + options.apiKey,
            form: {
                DCID: options.DCID,
                OSID: options.OSID,
                VPSPLANID: options.VPSPLANID
            },
            method: 'POST'
        }, function(err, response, body) {

            // check if req is done
            if (!err && response.statusCode !== 200) {
                console.log(err);
                return callback(err);
            }

            // create server db record
            var server = Server();
            // get server id
            var serverId = JSON.parse(body).SUBID;

            server.vulrt_id = serverId;
            server.save();

            // check when server is ready for ssh connection
            var timer = setInterval(function () {

                // get server info
                request({
                    url: 'https://api.vultr.com/v1/server/list?api_key=' + options.apiKey + '&SUBID=' + serverId,
                    method: 'GET'
                }, function (err, response, body) {

                    // check if req is done
                    if (!err && response.statusCode !== 200) {
                        console.log(err);
                        return callback(err);
                    }

                    var obj = JSON.parse(body);

                    server.status = 'Creating';
                    server.save();

                    // check if server ready
                    if (obj.power_status === 'running' && obj.server_state === 'ok' && obj.status === 'active' && obj.main_ip && obj.default_password) {

                        server.ip = obj.main_ip;
                        server.password = obj.default_password;
                        server.status = 'Created';
                        server.save();

                        // kill timer
                        clearInterval(timer);
                        return callback(null, server);
                    }
                });
            }, 5000);
        });
    },

    addServer: function(options, callback){

        if(!options.serverRootPassword || !options.serverIP){
            return callback(new Error('No root password or server IP provided!'));
        }

        var server = Server();
        server.root = options.serverRootName || server.root;
        server.password = options.serverRootPassword;
        server.ip = options.serverIP;
        server.save();

        return callback(null, server);

    },

    prepareServer: function(server, callback){
        if(!server){
            return callback(new Error('No server object! Cannot install software!'));
        }

        server.status = 'Installing software';
        server.save();

        var conn = new Client();
        conn.on('ready', function() {
            console.log('Client :: ready');

            // transfer sh script to server root folder
            conn.sftp(function(err, sftp) {
                // creating file stream
                var readStream = fs.createReadStream( "./sh/baseserv.sh" );
                var writeStream = sftp.createWriteStream( "/root/baseserv.sh" );

                writeStream.on('close', function () {
                    console.log( "File transferred" );
                    sftp.end();

                    // execute file
                    conn.exec('cd /root && sh baseserv.sh', function(err, stream){

                        if (err) {
                            return callback(err);
                        }

                        stream.on('close', function(code, signal) {

                            console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);

                            server.status = 'Software installed';
                            server.isSoftwareInstalled = true;
                            server.save();

                            stream.end();
                            conn.end();

                            return callback(null, server);

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
            server.status = 'Error while sftp connection';
            server.save();
            console.log(err);
            return callback(err);
        }).connect({
            host: server.ip,
            port: 22,
            username: server.root,
            password: server.password,
            readyTimeout: 999999
        });
    },

    createDomain: function(options, server, callback){
        if(!server || !options){
            return callback(new Error('No server object! Cannot create domain!'));
        }

        server.status = 'Creating domain';
        server.save();

        // ssh connection
        var conn = new Client();
        conn.on('ready', function() {
            console.log('Client :: ready');

            var command = 'virtualmin create-domain' +
                ' --domain "' + options.domain +
                '" --user "' + options.domainUser +
                '" --pass "' + options.domainPassword +
                '" --unix --dir --webmin --web --mail --mysql --limits-from-plan' +
                ' --mysql-pass "' + options.domainPassword + '"';

            conn.exec(command, function(err, stream){

                if (err) {
                    return console.log(err);
                }

                stream.on('close', function(code, signal){

                    server.status = 'Domain created';
                    server.domainUser = options.domainUser;
                    server.domainPassword = options.domainPassword;
                    server.domain = options.domain;
                    server.isDomainCreated = true;
                    server.save();

                    stream.end();
                    conn.end();

                    return callback(null, server);

                }).on('data', function(data) {

                    console.log('STDOUT: ' + data);

                }).stderr.on('data', function(data) {

                    console.log('STDERR: ' + data);

                });

            });


        }).on('error', function(err) {
            server.status = 'Error while sftp connection';
            server.save();
            console.log(err);
            return callback(err);
        }).connect({
            host: server.ip,
            port: 22,
            username: server.root,
            password: server.password,
            readyTimeout: 999999
        });
    },

    installWordpress: function(options, server, callback){
        if(!server || !options){
            return callback(new Error('No server object! Cannot create domain!'));
        }

        server.status = 'Installing Wordpress';
        server.save();

        // ssh connection
        var conn = new Client();
        conn.on('ready', function() {
            console.log('Client :: ready');

            var command = 'echo \'{"cmd":"install","application":"wordpress",' +
                '"user":"' + server.domainUser + '",'+
                '"url":"' + server.domain + '",'+
                '"email":"' + options.wpEmail + '",'+
                '"login":"' + options.wpUser + '",'+
                '"sitetitle":"' + options.wpTitle + '",'+
                '"sitetagline":"' + options.wpDescription + '",'+
                '"passwd":"' + options.wpPassword + '"}\' | /usr/local/installatron/installatron';

            conn.exec(command, function(err, stream){

                if (err) {
                    return console.log(err);
                }

                stream.on('close', function(code, signal){

                    server.status = 'Site ready!';
                    server.wpUser = options.wpUser;
                    server.wpPassword = options.wpPassword;
                    server.wpEmail = options.wpEmail;
                    server.isWordpressInstalled = true;
                    server.save();

                    stream.end();
                    conn.end();

                    return callback(null, server);

                }).on('data', function(data) {

                    console.log('STDOUT: ' + data);

                }).stderr.on('data', function(data) {

                    console.log('STDERR: ' + data);

                });

            });


        }).on('error', function(err) {
            server.status = 'Error while sftp connection';
            server.save();
            console.log(err);
            return callback(err);
        }).connect({
            host: server.ip,
            port: 22,
            username: server.root,
            password: server.password,
            readyTimeout: 999999
        });
    }
};
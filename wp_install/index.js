var ssh2 = require('ssh2');
var request = require('request');
var fs = require('fs');
var Client = ssh2.Client;
var Server = require('../models/server');

/**
 * @module WpInstall
* */

module.exports = {

    /**
    * Creating server on digitalocean.com
    * @param {object} options - Parameters for creating a server
    * @param {object} options.apiKey - Digitalocean api key
    * @param {object} options.REGION - Digitalocean region
    * @param {object} options.SIZE - Digitalocean plan
    * @param {object} options.IMAGE - Operating system
    * @param {function} callback - Callback with err and server objects
    * */
    createServerOnDO: function(options, callback){

        if(!options.apiKey || !options.REGION || !options.SIZE || !options.IMAGE) {
            return callback(new Error('Some parameters are missing!'));
        }

        request({
            url: 'https://api.digitalocean.com/v2/droplets',
            json: true,
            body: {
                "name": "example",
                "region": options.REGION,
                "size": options.SIZE,
                "image": options.IMAGE,
                "ssh_keys": null,
                "backups": false,
                "ipv6": true,
                "user_data": null,
                "private_networking": null
            },
            headers: {
                'Authorization': 'Bearer ' + options.apiKey,
                'Content-Type': 'application/json'
            },
            method: 'POST'
        }, function(err, response, body) {

            // check if req is done
            if (err && response.statusCode >= 300) {
                console.log(response.statusCode);
                console.log(err);
                console.log(body);
                return callback(err);
            }

            // create server db record
            var server = Server();
            // get server id
            var serverId = body.droplet.id;
            console.log(serverId);
            server.do_id = serverId;
            server.save();

            // check when server is ready for ssh connection
            var timer = setInterval(function () {

                // get server info
                request({
                    url: 'https://api.digitalocean.com/v2/droplets/' + serverId,
                    headers: {
                        'Authorization': 'Bearer ' + options.apiKey,
                        'Content-Type': 'application/json'
                    },
                    method: 'GET'
                }, function (err, response, body) {

                    // check if req is done
                    if (err && response.statusCode >= 300) {
                        console.log(err);
                        return callback(err);
                    }

                    var obj = JSON.parse(body).droplet;

                    server.status = 'Creating';
                    server.save();
                    console.log(obj.networks.v4[0].ip_address);
                    // check if server ready
                    if (obj.locked === false && obj.status === 'active' && obj.networks.v4[0].ip_address) {

                        server.ip = obj.networks.v4[0].ip_address;
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


    /**
     * Creating server on vultr.com
     * @param {object} options - Parameters for creating a server
     * @param {object} options.apiKey - Vultr api key
     * @param {object} options.DCID - Vultr region ID
     * @param {object} options.OSID - Operating system ID
     * @param {object} options.VPSPLANID - Vultr plan ID
     * @param {function} callback - Callback with err and server objects
     * */
    createServerOnVultr: function(options, callback){

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
            if (err && response.statusCode >= 300) {
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
                    if (err && response.statusCode >= 300) {
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

    /**
     * Add already prepared server to db
     * @param {object} options - Parameters for adding a server
     * @param {object} options.serverRootPassword - Server root user password
     * @param {object} options.serverIP - Server IP address
     * @param {function} callback - Callback with err and server objects
     * */
    addServer: function(options, callback){

        if(!options.serverRootPassword || !options.serverIP){
            return callback(new Error('No root password or server IP provided!'));
        }

        var server = Server();
        server.root = options.serverRootName || server.root;
        server.password = options.serverRootPassword;
        server.ip = options.serverIP;

        if(options.serverType === "cpanel") {
            server.cpanel = true;
        }

        server.status = 'Software installed';
        server.isSoftwareInstalled = true;

        server.save();

        return callback(null, server);

    },

    /**
     * Preparing server (installing software)
     * @param {object} server - Server object from db
     * @param {function} callback - Callback with err and server objects
     * */
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
                if(err || !sftp){
                    return callback(err);
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
                            return callback(err);
                        }

                        stream.on('close', function(code, signal) {

                            console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);
                            if (code > 0) {
                                server.status = 'Error in software installation';
                                server.isSoftwareInstalled = false;
                            } else {
                                server.status = 'Software installed';
                                server.isSoftwareInstalled = true;
                            }

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

    /**
     * Creating domain on a server
     * @param {object} options - Options for domain creation
     * @param {object} options.domain - Domain name
     * @param {object} options.domainUser - Domain user name
     * @param {object} options.domainPassword - Domain user password
     * @param {object} server - Server object from db
     * @param {function} callback - Callback with err and server objects
     * */
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
            var command;

            if(server.cpanel) {

                command = '/scripts/wwwacct ' +
                    '"'+ options.domain + '" ' +
                    '"' + options.domainUser + '" ' +
                    '"' + options.domainPassword + '" 0 x3 n n n  0 0 0 0 0 0';

            } else {
                command = 'virtualmin create-domain' +
                    ' --domain "' + options.domain +
                    '" --user "' + options.domainUser +
                    '" --pass "' + options.domainPassword +
                    '" --unix --dir --webmin --web --mail --mysql --limits-from-plan' +
                    ' --mysql-pass "' + options.domainPassword + '"';
            }

            conn.exec(command, function(err, stream){

                if (err) {
                    return console.log(err);
                }

                stream.on('close', function(code, signal){
                    console.log(code);
                    if (code > 0) {
                        server.status = 'Error in domain creation';
                    } else {
                        server.status = 'Domain created';
                    }
                    server.domain = options.domain;
                    server.domainUser = options.domainUser;
                    server.domainPassword = options.domainPassword;
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

    /**
     * Installing Wordpress
     * @param {object} options - Options for Wordpress installation
     * @param {object} options.dbName - Database name
     * @param {object} options.dbUser - Database user name
     * @param {object} options.dbPassword - Database user password
     * @param {object} options.wpTitle - Website title
     * @param {object} options.wpDescription - Website description
     * @param {object} options.wpUser - Website administrator user name
     * @param {object} options.wpPassword - Website administrator user password
     * @param {object} options.wpEmail - Website administrator email
     * @param {object} server - Server object from db
     * @param {function} callback - Callback with err and server objects
     * */
    installWordpress: function(options, server, callback){
        if(!server || !options){
            return callback(new Error('No server object! Cannot create domain!'));
        }

        server.status = 'Installing Wordpress';
        server.save();

        var username,password;
        if (server.cpanel == true) {
            username = server.domainUser;
            password = server.domainPassword;
        } else {
            username = server.root;
            password = server.password;
        }

        console.log(username + ' ' + password);
        // ssh connection
        var conn = new Client();
        conn.on('ready', function() {
            console.log('Client :: ready');

            var command;

            if (server.cpanel) {
                command = 'cd ~/public_html && ' +
                    'wp core download && ' +
                    'wp core config --dbname="' + options.dbName +
                    '" --dbuser="' + options.dbUser +
                    '" --dbpass="' + options.dbPassword +
                    '" && ' +
                'wp core install --url="'+ server.domain +
                '" --title="'+ options.wpTitle +
                '" --admin_user="'+ options.wpUser +
                '" --admin_password="'+ options.wpPassword +
                '" --admin_email="'+ options.wpEmail +
                '"';
            } else {
                command = 'echo \'{"cmd":"install","application":"wordpress",' +
                    '"user":"' + server.domainUser + '",'+
                    '"url":"' + server.domain + '",'+
                    '"email":"' + options.wpEmail + '",'+
                    '"login":"' + options.wpUser + '",'+
                    '"sitetitle":"' + options.wpTitle + '",'+
                    '"sitetagline":"' + options.wpDescription + '",'+
                    '"passwd":"' + options.wpPassword + '"}\' | /usr/local/installatron/installatron';
            }

            conn.exec(command, function(err, stream){

                if (err) {
                    return console.log(err);
                }

                stream.on('close', function(code, signal){
                    if (code > 0) {
                        server.status = 'Error in Wordpress installation';
                    } else {
                        server.status = 'Site ready!';
                        server.wpUser = options.wpUser;
                        server.wpPassword = options.wpPassword;
                        server.wpEmail = options.wpEmail;
                        server.isWordpressInstalled = true;
                    }

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
            username: username,
            password: password,
            readyTimeout: 999999
        });
    }
};
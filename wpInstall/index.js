'use strict';

let request = require('request');
let async = require('async');
let logger = require('../logger')();
let _ = require('underscore');
let walk = require('walk');
let path = require('path');
let fs = require('fs');
let moment = require('moment');
var keypair = require('keypair');
var forge = require('node-forge');

let SshClient = require('ssh2').Client;
let Ftp = require('ftp');
let Server = require('../models').Server;

/**
 * TODO vultr and DO server names
 * TODO Callback was already called error in FTP
 * */

/**
 * Get Wordpress config file (Buffer)
 * @param {object} options - Object with DB congif info
 * @param {string} options.dbName - DB name
 * @param {string} options.dbUser - DB user
 * @param {string} options.dbPassword - DB password
 * @param {string} options.dbHost - DB host
 * @param {string} options.dbCharset - DB charset
 * @param {string} options.dbCollate - idgaf
 * @param {getConfigCallback} callback - Callback function
 **/
function getConfig(options, callback){

    if(!options || !options.dbName || !options.dbUser || !options.dbPassword){
        return callback(new Error('Missing some parameters in options!'));
    }

    let defaults = {
        dbHost: 'localhost',
        dbCharset: 'utf8',
        dbCollate: ''
    };

    _.extend(defaults, options);

    let config = `<?php\n\n
            define('DB_NAME', '${defaults.dbName}');\n
            define('DB_USER', '${defaults.dbUser}');\n
            define('DB_PASSWORD', '${defaults.dbPassword}');\n
            define('DB_HOST', '${defaults.dbHost}');\n
            define('DB_CHARSET', '${defaults.dbCharset}');\n
            define('DB_COLLATE', '${defaults.dbCollate}');\n\n`;

    request({
        url: 'https://api.wordpress.org/secret-key/1.1/salt/'
    }, function(err, response, body){

        if(err) return callback(err);

        config += body + `\n\n
                $table_prefix  = 'wp_';\n
                define('WP_DEBUG', false);\n
                if ( !defined('ABSPATH') )\n
                \tdefine('ABSPATH', dirname(__FILE__) . '/');\n
                require_once(ABSPATH . 'wp-settings.php');`;


        return callback(null, new Buffer(config, 'utf8'));
    });
}
/**
 * Callback function
 * @callback getConfigCallback
 * @param {string} err - Error object
 * @param {Buffer} buffer - Buffer object
 **/

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

        let pair = keypair();
        //let publicKey = forge.pki.publicKeyFromPem(pair.public);
        //let publicSSHKey = forge.ssh.publicKeyToOpenSSH(publicKey, 'creatr@localhost');

        let publicKey = forge.pki.publicKeyFromPem(pair.public);
        let privateKey = forge.pki.privateKeyFromPem(pair.private);
        let privateSSHKey = forge.ssh.privateKeyToOpenSSH(privateKey, 'FromCreatRWithLove');
        let publicSSHKey = forge.ssh.publicKeyToOpenSSH(publicKey, 'creatr@localhost');
        logger.info(privateSSHKey);
        logger.info(publicSSHKey);

        request({
                url: 'https://api.digitalocean.com/v2/account/keys',
                json: true,
                body: {
                    "name": "Made With CreatR " + moment().format('MM.DD.YYYY h:mm:ss'),
                    "public_key": publicSSHKey
                },
                headers: {
                    'Authorization': 'Bearer ' + options.apiKey,
                    'Content-Type': 'application/json'
                },
                method: 'POST'
            }, function(err, response, body) {

            // check if req is done
            if (err && response.statusCode >= 300) {
                logger.error(response.statusCode, err);
                return callback(err);
            }

            var s = body.toString();

            var publicKeyID = parseInt(s.slice(s.indexOf('=') + 1,s.indexOf(',')));
            var fp = forge.ssh.getPublicKeyFingerprint(publicKey, {encoding: 'hex', delimiter: ':'});
            logger.info(publicKeyID);

            request({
                url: 'https://api.digitalocean.com/v2/droplets',
                json: true,
                body: {
                    "name": "Made-With-CreatR-" + moment().format('MM-DD-YYYY--h-mm-ss'),
                    "region": options.REGION,
                    "size": options.SIZE,
                    "image": options.IMAGE,
                    "ssh_keys": [fp],
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
                    logger.error(response.statusCode, err);
                    return callback(err);
                }

                // create server db record
                var server = Server();
                server.ssh = privateSSHKey;
                // TODO uncomment
                server.id = parseInt(options.newID);          //<-- Added by Hitek
                server.user = parseInt(options.user);      //<-- Added by Hitek

                // get server id
                var serverId = body.droplet.id;
                logger.info('Server id',serverId);
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
                            logger.error(err);
                            return callback(err);
                        }

                        var obj = JSON.parse(body).droplet;

                        server.status = 'Creating';
                        server.save();

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

        });


    },

    /**
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
                VPSPLANID: options.VPSPLANID,
                label: 'Made With CreatR'
            },
            method: 'POST'
        }, function(err, response, body) {

            // check if req is done
            if (err && response.statusCode >= 300) {
                logger.error(err.message);
                return callback(err);
            }

            // create server db record
            var server = Server();
            server.id = parseInt(options.newID);          //<-- Added by Hitek
            server.user = parseInt(options.user);     //<-- Added by Hitek
            // get server id
            var serverId = JSON.parse(body).SUBID;

            server.vultr_id = serverId;
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
                        logger.error(err.message);
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
     * Preparing server (installing software)
     * @param {object} server - Server object from db
     * @param {function} callback - Callback with err and server objects
     * */
    prepareServer: function(server, callback){
        if(!server){
            return callback(new Error('No server object! Cannot install software!'));
        }

        server.status = parseInt(server.status.substring(16)) > 0 && parseInt(server.status.substring(16)) < 5 ? "Install Attempt "+(parseInt(server.status.substring(16))+1) : "Install Attempt 1"; //<-- Added by Hitek
        server.save(); //<-- Added by Hitek

        var conn = new SshClient();
        conn.on('ready', function() {
            logger.info('Client :: ready');
            server.status = "Installing";
            server.save();

            // transfer sh script to server root folder
            conn.sftp(function(err, sftp) {
                if(err || !sftp){
                    return callback(err);
                }

                // creating file stream
                var readStream = fs.createReadStream( path.join(__dirname, "data/baseserv.sh") );
                var writeStream = sftp.createWriteStream( "/root/baseserv.sh" );

                writeStream.on('close', function () {
                    logger.info( "File transferred" );
                    sftp.end();

                    // execute file
                    conn.exec('cd /root && sh baseserv.sh', function(err, stream){

                        if (err) {
                            return callback(err);
                        }

                        stream.on('close', function(code, signal) {

                            logger.info('Stream :: close :: code: ' + code + ', signal: ' + signal);
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

                            logger.info('STDOUT: ' + data);

                    }).stderr.on('data', function(data) {

                            logger.info('STDERR: ' + data);

                    });

                });
            });
            // transfer file
            readStream.pipe( writeStream );
        });

        }).on('error', function(err) {

            if (parseInt(server.status.substring(16)) == 5){ //<-- Added by Hitek
                server.status = 'Error while sftp connection';
                server.save();
                logger.error(err);
                return callback(err);
        // v-- Added by Hitek
            } else {
                server.status = parseInt(server.status.substring(16)) > 0 && parseInt(server.status.substring(16)) < 5 ? "Install Attempt "+(parseInt(server.status.substring(16))+1) : "Install Attempt 1";
                server.save();

                logger.info("Connection Failed. Retrying");
                setTimeout(function(){
                    if(server.ssh){
                        logger.info('good');
                        conn.connect({
                            host: server.ip,
                            port: 22,
                            username: 'root',
                            passphrase: 'FromCreatRWithLove',
                            privateKey: server.ssh,
                            readyTimeout: 5000
                        });
                    } else {
                        conn.connect({
                            host: server.ip,
                            port: 22,
                            username: 'root',
                            password: server.password,
                            readyTimeout: 5000
                        });
                    }
                }, 10000);
            }
        // ^-- Added by Hitek
        });

        if(server.ssh){
            logger.info(server.ip);
            conn.connect({
                host: server.ip,
                port: 22,
                username: 'root',
                passphrase: 'FromCreatRWithLove',
                privateKey: server.ssh,
                readyTimeout: 5000
            });
        } else {
            conn.connect({
                host: server.ip,
                port: 22,
                username: server.root,
                password: server.password,
                readyTimeout: 5000
            });
        }


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
     * Install Wordpress on shared-hosting
     * @param {object} options - Object with installation options
     * @param {string} options.ftpPath -
     * @param {string} options.ftpUser -
     * @param {string} options.ftpPassword -
     * @param {string} options.ftpHost -
     * @param {string} options.domain -
     * @param {string} options.dbName -
     * @param {string} options.dbHost -
     * @param {string} options.dbUser -
     * @param {string} options.dbPassword -
     * @param {object} options.wpTitle - Website title
     * @param {object} options.wpDescription - Website description
     * @param {object} options.wpUser - Website administrator user name
     * @param {object} options.wpPassword - Website administrator user password
     * @param {object} options.wpEmail - Website administrator email
     * */

    installWordpressOnSharedHosting: function(options, callback){

        if(!_.has(options, 'ftpPath') || !_.has(options, 'ftpUser') ||
            !_.has(options, 'ftpPassword') || !_.has(options, 'ftpHost') ||
            !_.has(options, 'domain') || !_.has(options, 'dbName') || !_.has(options, 'dbHost') ||
            !_.has(options, 'dbUser') || !_.has(options, 'dbPassword') ||
            !_.has(options, 'wpTitle') || !_.has(options, 'wpDescription') ||
            !_.has(options, 'wpUser') || !_.has(options, 'wpPassword') || !_.has(options, 'wpEmail')){

            return callback(new Error('Some parameters are missing!'));

        }

        async.waterfall([

            /**
             * Get wordpress files and directories
             * */
            function(cb){

                let files = [];
                let directories = [];
                let ROOT = path.join(__dirname, 'data/wordpress');

                walk.walk(ROOT, { followLinks: false })
                    .on('directory', function(root, fileStat, next){

                        directories.push({
                            type: 'd',
                            name: null,
                            path: path.join(root.replace(ROOT, ''), fileStat.name)
                        });
                        next();

                    })
                    .on('file', function(root, fileStat, next){

                        files.push({
                            type: 'f',
                            name: fileStat.name,
                            path: path.join(root.replace(ROOT, ''), fileStat.name)
                        });
                        next();

                    })
                    .on('end', function(){

                        return cb(null, directories, files);

                    });

            },

            /**
             * Get wordpress config file
             * */
            function(directories, files, cb){
                getConfig(options, (err, wpconf)=>{
                    if (err){
                        logger.error(err.message);
                        return cb(err);
                    }
                    return cb(null, directories, files, wpconf);
                });
            },

            /**
             * Upload wordpress
             * */
            function(directories, files, wpconf, cb){

                let ftpClient = new Ftp();

                // upload
                async.waterfall([

                    /**
                     * Create directories
                     * */
                    function(cb){

                        ftpClient.on('close', function(){
                            logger.info('ftp connection closed!');
                        })
                        .on('ready', function(){

                            async.each(directories, function(item, next){
                                ftpClient.mkdir(path.join(options.ftpPath, item.path), function(err){
                                    if (err){
                                        logger.error(err.message);
                                        return next(err);
                                    } else {
                                        logger.info('created dir: ' + options.ftpPath + item.path);
                                        return next();
                                    }
                                });
                            }, function(err){
                                if (err){

                                    logger.error(err.message);
                                    return cb(err);
                                }

                                return cb(null);
                            });

                        })
                        .connect({
                            host: options.ftpHost,
                            user: options.ftpUser,
                            password: options.ftpPassword
                        });

                    },

                    /**
                     * Upload wp-config
                     * */
                    function(cb){

                        ftpClient.put(wpconf, path.join( options.ftpPath, 'wp-config.php' ), function(err) {

                            if (err){
                                logger.error(err.message);
                                return cb(err);
                            }
                            cb(null);
                        });

                    },

                    function(cb){
                        async.each(files, function(item, next){

                            ftpClient.put(path.join(__dirname, 'data/wordpress', item.path), path.join( options.ftpPath, item.path), function(err) {

                                if (err){

                                    if(err.message.indexOf('Unable to make data connection') > -1 ||
                                        err.message.indexOf('File exists') > -1){
                                        logger.info(err.message, path.join( options.ftpPath, item.path));
                                        return next();
                                    } else {
                                        logger.error(err.message, path.join( options.ftpPath, item.path));
                                        return next(err);
                                    }
                                } else {
                                    logger.info('uploaded: ' + path.join( options.ftpPath, item.path ));
                                    return next();
                                }
                            });

                        }, function(err){
                            if (err){

                                logger.error(err.message);
                                return cb(err);
                            }

                            return cb(null);
                        });
                    },

                    /**
                     * Install wordpress
                     * */
                    function(cb){
                        request({
                            url: (options.domain.endsWith('/')) ? options.domain.slice(0, -1) + '/wp-admin/install.php?step=2': options.domain + '/wp-admin/install.php?step=2',
                            method: 'POST',
                            form: {
                                weblog_title: options.wpTitle,
                                user_name: options.wpUser,
                                pw_weak: true,
                                admin_password: options.wpPassword,
                                admin_password2: options.wpPassword,
                                admin_email: options.wpEmail,
                                blog_public: 0
                            }
                        }, function(err, response, body){

                            if(err) {
                                logger.error(err.message);
                                return cb(err);
                            }

                            return cb(null);
                        });
                    }

                ], function(err, result){
                    if (err){
                        ftpClient.end();
                        logger.error(err.message);
                        return cb(err);
                    }
                    ftpClient.end();
                    return cb(null, result);
                });
            }

        ], function(err, result){
            if (err){
                logger.error(err.message);
                return callback(err);
            }

            return callback(null, result);
        });

    },



    installWordpressOnSharedHosting2: function(options, callback){

        if(!_.has(options, 'ftpPath') || !_.has(options, 'ftpUser') ||
            !_.has(options, 'ftpPassword') || !_.has(options, 'ftpHost') ||
            !_.has(options, 'domain') || !_.has(options, 'dbName') || !_.has(options, 'dbHost') ||
            !_.has(options, 'dbUser') || !_.has(options, 'dbPassword') ||
            !_.has(options, 'wpTitle') || !_.has(options, 'wpDescription') ||
            !_.has(options, 'wpUser') || !_.has(options, 'wpPassword') || !_.has(options, 'wpEmail')){

            return callback(new Error('Some parameters are missing!'));

        }

        var JSFtp = require("jsftp");

        async.waterfall([

            /**
             * Get wordpress files and directories
             * */
                function(cb){

                let files = [];
                let directories = [];
                let ROOT = path.join(__dirname, 'data/wordpress');

                walk.walk(ROOT, { followLinks: false })
                    .on('directory', function(root, fileStat, next){

                        directories.push({
                            type: 'd',
                            name: null,
                            path: path.join(root.replace(ROOT, ''), fileStat.name)
                        });
                        next();

                    })
                    .on('file', function(root, fileStat, next){

                        files.push({
                            type: 'f',
                            name: fileStat.name,
                            path: path.join(root.replace(ROOT, ''), fileStat.name)
                        });
                        next();

                    })
                    .on('end', function(){

                        return cb(null, directories, files);

                    });

            },

            /**
             * Get wordpress config file
             * */
             function(directories, files, cb){
                getConfig(options, (err, wpconf)=>{
                    if (err){
                        logger.error(err.message);
                        return cb(err);
                    }
                    return cb(null, directories, files, wpconf);
                });
            },

            /**
             * Upload wordpress
             * */
             function(directories, files, wpconf, cb){

                let ftpClient = new JSFtp({
                    host: options.ftpHost,
                    user: options.ftpUser,
                    pass: options.ftpPassword,
                    port: 21
                });

                // upload
                async.waterfall([

                    function(cb){
                        ftpClient.auth(options.ftpUser, options.ftpPassword, function(err){
                            if (err){
                                logger.error(err.message);
                                return cb(err);
                            }

                            cb();
                        });
                    },

                    /**
                     * Create directories
                     * */
                    function(cb){

                        async.each(directories, function(item, next){
                            ftpClient.raw.mkd(path.join(options.ftpPath, item.path), function(err){
                                if (err){
                                    logger.error(err.message);
                                    return next(err);
                                } else {
                                    logger.info('created dir: ' + options.ftpPath + item.path);
                                    return next();
                                }
                            });
                        }, function(err){
                            if (err){

                                logger.error(err.message);
                                return cb(err);
                            }

                            return cb(null);
                        });

                    },

                    /**
                     * Upload wp-config
                     * */
                     function(cb){

                        ftpClient.put(wpconf, path.join( options.ftpPath, 'wp-config.php' ), function(err) {

                            if (err){
                                logger.error(err.message);
                                return cb(err);
                            }
                            logger.info('uploaded: ' + path.join( options.ftpPath, 'wp-config.php' ));
                            cb(null);
                        });

                    },

                    function(cb){

                        async.each(files, function(item, next){

                            /*fs.readFile(path.join(__dirname, 'data/wordpress', item.path), function (err, data ) {
                                if (err){
                                    return next(err);
                                }*/

                                ftpClient.put(fs.readFileSync(path.join(__dirname, 'data/wordpress', item.path)), path.join( options.ftpPath, item.path), function(err) {
                                    if (err){

                                        /*if(err.message.indexOf('Unable to make data connection') > -1 ||
                                            err.message.indexOf('File exists') > -1){
                                            logger.info(err.message, path.join( options.ftpPath, item.path));
                                            return next();
                                        } else {*/
                                            logger.error(err.message, path.join( options.ftpPath, item.path));
                                            return next(err);
                                        //}
                                    } else {
                                        logger.info('uploaded: ' + path.join( options.ftpPath, item.path ));
                                        return next();
                                    }
                                });
                            //});



                        }, function(err){
                            if (err){

                                logger.error(err.message);
                                return cb(err);
                            }

                            return cb(null);
                        });
                    }//,

                    /**
                     * Install wordpress
                     * */
                        /*function(cb){
                        request({
                            url: (options.domain.endsWith('/')) ? options.domain.slice(0, -1) + '/wp-admin/install.php?step=2': options.domain + '/wp-admin/install.php?step=2',
                            method: 'POST',
                            form: {
                                weblog_title: options.wpTitle,
                                user_name: options.wpUser,
                                pw_weak: true,
                                admin_password: options.wpPassword,
                                admin_password2: options.wpPassword,
                                admin_email: options.wpEmail,
                                blog_public: 0
                            }
                        }, function(err, response, body){

                            if(err) {
                                logger.error(err.message);
                                return cb(err);
                            }

                            return cb(null);
                        });
                    }*/

                ], function(err, result){
                    if (err){
                        //ftpClient.end();
                        logger.error(err.message);
                        return cb(err);
                    }
                    //ftpClient.end();
                    return cb(null, result);
                });
            }

        ], function(err, result){
            if (err){
                logger.error(err.message);
                return callback(err);
            }

            return callback(null, result);
        });

    }
};

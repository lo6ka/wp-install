'use strict';

let Router = require('express').Router();
let wpInstall = require('../wpInstall');
let logger = require('../logger')();
let Server = require('../models').Server;

/**
*
* POST /api/server/add
* POST /api/server/create/do
* POST /api/server/create/vultr
* POST /api/server/install
* POST /api/domain/create
* POST /api/wordpress/install/shared
* POST /api/wordpress/install/server
*
* */

/**
 * Get Server by ID
 * */
Router.get('/server/:id', function(req, res, next){
    res.send(req.baseUrl);
});

/**
 * Add already created server
 * */
Router.post('/server/add', function(req, res, next){

    wpInstall.addServer(req.body, function(err, server){
        if(err){
            return res.json({
                error: true,
                message: err.message
            });
        }

        res.json({
            success: true,
            r: server._id
        });
    });

});

/**
 * Create server on Digitalocean
 * */
Router.post('/server/create/do', function(req, res, next){

    wpInstall.createServerOnDO(req.body, function(err, server){
        if(err) {
            logger.error(err.message);
            return res.json({
                error: true,
                message: err.message
            });
        }

        wpInstall.prepareServer(server, function(err, server){
            if(err && !server) {

                setTimeout(function(){

                    wpInstall.prepareServer(server, function(err, server){
                        if(err){
                            return logger.error(err.message);
                            /*return res.json({
                                error: true,
                                message: err.message
                            });*/
                        }

                        /*res.json({
                            success: true,
                            r: server._id
                        });*/

                    });

                }, 5000);

            }

            /*res.json({
                success: true,
                r: server._id
            });*/

        });

        res.json({
            success: true,
            r: server._id
        });

    });

});

/**
 * Create server on Vultr
 * */
Router.post('/server/create/vultr', function(req, res, next){

    wpInstall.createServerOnVultr(req.body, function(err, server){
        if(err){
            logger.error(err.message);
            return res.json({
                error: true,
                message: err.message
            });
        }

        wpInstall.prepareServer(server, function(err, server){
            if(err && !server) {

                setTimeout(function(){

                    wpInstall.prepareServer(server, function(err, server){
                        if(err){
                            logger.error(err.message);
                            return res.json({
                                error: true,
                                message: err.message
                            });
                        }

                        res.json({
                            success: true,
                            r: server._id
                        });

                    });

                }, 5000);

            }

            res.json({
                success: true,
                r: server._id
            });

        });
    });
});

/**
 *  Create domain
 * */
Router.post('/domain/create', function(req, res, next){

    Server.findById(req.body.server, function(err, server){

        wpInstall.createDomain(req.body, server, function(err, server){
            if(err){
                return res.json({
                    error: true,
                    message: err.message
                });
            }

            logger.info('Domain successfully created!');
            return res.json({
                success: true,
                r: result
            });

        });

    });

});

/**
 * Install Wordpress
 * */
Router.post('/wordpress/install/server', function(req, res, next){

    Server.findById(req.body.server, function(err, server){

        wpInstall.installWordpress(req.body, server, function(err, server){

            if(err && !server) {
                return res.json({
                    error: true,
                    message: err.message
                });
            }

            logger.info('Wordpress successfully installed!');
            return res.json({
                success: true,
                r: result
            });

        });

    });

});

/**
 * Install Wordpress on shared-hosting
 * */
Router.post('/wordpress/install/shared', function(req, res, next){

    var options = req.body;
    wpInstall.installWordpressOnSharedHosting(options, function(err, result){

        if(err){
            return res.json({
                error: true,
                message: err.message
            });
        }
        logger.info('Wordpress successfully installed!');
        return res.json({
            success: true,
            r: result
        });
    });

});

module.exports = Router;
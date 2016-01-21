'use strict';

let Router = require('express').Router();
let Server = require('../models').Server;

Router.get('/', function(req, res, next){
    Server.find({}, function(err, servers){
        if(err) {
            return next(err);
        }

        res.render('index', { servers: servers });
    });
});

module.exports = Router;
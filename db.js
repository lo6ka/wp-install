'use strict';

let mongoose = require('mongoose');
let config = require('./config');
let logger = require('./logger')();

let db = config.get('database');

function getURL(){
    return 'mongodb://' + config.get('database:user') + ':' + config.get('database:password') +
        '@' + config.get('database:host') + ':' + config.get('database:port') + '/' + config.get('database:dbname');
}

module.exports.connect = function(){

    mongoose.connect('mongodb://localhost/wpinstall', (err) => {
        if (err) {
            logger.error(err.message);
            throw err;
        }
    });

};
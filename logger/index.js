'use strict';

let winston = require( 'winston' );
let moment = require('moment');
let config = require('../config');

module.exports = function(){
    return (function(){

        let transports = [
            new winston.transports.Console({
                timestamp: () => {
                    return moment().format('MM.DD.YYYY, h:mm:ss');
                },
                colorize: true,
                level: config.get('logger:consoleLevel')
            }),
             new winston.transports.File({
                 filename: 'debug.log',
                 timestamp: () => {
                     return moment().format('MM.DD.YYYY, h:mm:ss');
                 },
                 maxsize: config.get('logger:maxSize'),
                 level: config.get('logger:fileLevel')
             })
        ];

        return new winston.Logger({ transports: transports }) ;
    })();
};
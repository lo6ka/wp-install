'use strict';

let path = require('path');
let cluster = require('cluster');
let logger = require('./logger')();
let config = require('./config');

if(cluster.isMaster) {

    var cpuCount = require('os').cpus().length;

    for (var i = 0; i < cpuCount; i += 1) {
        cluster.fork();
    }

    cluster.on('exit', function (worker) {

        logger.info(`Worker ${worker.id} died`);
        // TODO Don't forget to uncomment this!
        //cluster.fork();

    });

    logger.info(`Application is listening on port ${config.get('port')}`);

} else {

    /**
    * Requires for app
    * */
    let express = require('express');
    let cookieParser = require('cookie-parser');
    let bodyParser = require('body-parser');
    let app = express();
    let mongoose = require('mongoose');
    let routes = require('./routes');
    let db = require('./db');
    db.connect();

    if(config.get('views')){
        app.set('views', path.join(__dirname, 'views'));
        app.set('view engine', 'ejs');
    }

    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: false }));
    app.use(cookieParser());
    if(config.get('views')) {
        app.use(express.static(path.join(__dirname, 'public')));
        app.use('/', routes.view);
    }

    app.use('/api', routes.api);

    app.listen(config.get('port'));

    /**
     * Handle 404 error
     * */
    app.use( (req, res, next) => {
        var err = new Error('Not Found');
        err.status = 404;
        next(err);
    });

    app.use((err, req, res, next) => {
        logger.error(`${err.status || 500} - ${err.stack} ${req.originalUrl}`);
        res.status(err.status || 500);
        res.json({
            error: true,
            message: `${err.message} ${req.originalUrl}`,
            status: err.status || 500
        });
    });

    //logger.info(`Worker ${cluster.worker.id} running!`);
}
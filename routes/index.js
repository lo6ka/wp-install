var express = require('express');
var wp_install = require('../wp_install');
var router = express.Router();
var Server = require('../models/server');

/* GET home page. */
router.get('/', function(req, res, next) {
  Server.find({}, function(err, servers){
    if(err) {
      return next(err);
    }

    res.render('index', { servers: servers });
  });
});

router.get('/server/:serverid', function(req, res, next) {
  Server.findOne({_id: req.params.serverid}, function(err, server){
    if(err) {
      return next(err);
    }

    res.json(server);
  });
});

/* Create server on Vulrt.com */
router.post('/server/create', function(req, res, next){

  wp_install.createServer(req.body, function(err, server){
    if(err && !server) {
      console.log(err);
    }

    console.log('Server created!');

    wp_install.prepareServer(server, function(err, server){
      if(err && !server) {

        // to avoid an error
        setTimeout(function(){

          wp_install.prepareServer(server, function(err, server){
            if(err && !server) {
              console.log(err);
            }

            console.log('Software installed!');

          });

        }, 5000);

      }

      console.log('Software installed!');

    });
  });

  return res.redirect('/');
});

/* Add info about already created server and install software */
router.post('/server/add', function(req, res, next){

  wp_install.addServer(req.body, function(err, server){
    if(err && !server) {
      console.log(err);
    }

    wp_install.prepareServer(server, function(err, server){
      if(err && !server) {
        console.log(err);
      }

      console.log('Software installed!');

    });

  });

  return res.redirect('/');

});

/* Create domain */
router.post('/server/createDomain', function(req, res, next){

  Server.findById(req.body.server, function(err, server){

    wp_install.createDomain(req.body, server, function(err, server){
      if(err && !server) {
        console.log(err);
        return next(err);
      }

    });

    return res.redirect('/');
  });

});

/* Install Wordpress */
router.post('/server/installWordpress', function(req, res, next){

  Server.findById(req.body.server, function(err, server){

    wp_install.installWordpress(req.body, server, function(err, server){

      if(err && !server) {
        console.log(err);
      }

    });

    return res.redirect('/');
  });

});

router.post('/', function(req, res, next) {

  var options = req.body;

  if(!options.apiKey){
    return res.send('There is no api key');
  }

  wp_install.createWPServerOnVultr(req, res, next, options);

});

module.exports = router;

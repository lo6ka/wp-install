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

router.post('/', function(req, res, next) {

  var options = req.body;

  if(!options.apiKey){
    return res.send('There is no api key');
  }

  wp_install.createWPServerOnVultr(req, res, next, options);

});

module.exports = router;

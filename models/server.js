var mongoose = require('mongoose');

var Server = mongoose.Schema({
    vulrt_id: String,
    ip: String,
    user: String,
    password: String,
    status: String,
    ready: Boolean
});

module.exports = mongoose.model('servers', Server);
var mongoose = require('mongoose');

var Site = mongoose.Schema({
    url: String,
    login: String,
    password: String,
    dbName: String,
    dbUser: String,
    dbPassword: String
});

var User = mongoose.Schema({
    vultr: {
        username: String,
        password: String,
        apiKey: String
    },
    email: String,
    servers: [Server],
    sites: [Site]
});

module.exports = mongoose.model('users', User);
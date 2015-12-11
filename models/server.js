var mongoose = require('mongoose');

var Server = mongoose.Schema({
    vulrt_id: String,
    ip: String,
    user: String,

    root: {
        type: String,
        default: 'root'
    },
    password: String,

    cpanel: {
        type: Boolean,
        default: false
    },

    dbName: {
        type: String
    },

    dbUser: {
        type: String
    },

    dbPassword: {
        type: String
    },

    domainUser: {
        type: String
    },
    domainPassword: {
        type: String
    },
    domain: {
        type: String
    },

    wpUser: {
        type: String
    },
    wpPassword: {
        type: String
    },
    wpEmail: {
        type: String
    },

    status: {
        type: String,
        default: 'Not ready'
    },
    ready: {
        type: Boolean,
        default: false
    },

    isSoftwareInstalled: {
        type: Boolean,
        default: false
    },
    isDomainCreated: {
        type: Boolean,
        default: false
    },
    isWordpressInstalled: {
        type: Boolean,
        default: false
    }
});

module.exports = mongoose.model('servers', Server);
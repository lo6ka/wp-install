var Servers = Backbone.Collection.extend({
    url: '/server'
});
var servers = new Servers();
console.log(servers.fetch());
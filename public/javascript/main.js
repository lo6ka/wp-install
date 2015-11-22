$(document).ready(function(){
    var servers = $('#servers tr');
    servers.each(function(index){

        var that = $(this);

        setInterval(function(){
            var serverId = that.data('server');
            var url = '/server/' + that.data('server');

            if(serverId){
                $.ajax({
                    url: url,
                    success: function(data) {
                        that.html('<td><a href="http://' + data.ip + '">' + data.ip + '</a></td>' + '<td>' + data.ready + '</td>' + '<td>' + data.status + '</td>');
                    }
                });
            }

        }, 5000);
    });

});
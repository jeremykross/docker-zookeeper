var fs = require("fs");
var os = require("os");
var _ = require("lodash");
var async = require("async");
var dns = require("native-dns");
var request = require("request");
var child_process = require("child_process");

async.parallel({
    CLUSTER_LEADER: function(fn){
        var question = dns.Question({
          name: ["leaders", process.env.CS_CLUSTER_ID, "containership"].join("."),
          type: "A"
        });

        var req = dns.Request({
            question: question,
            server: { address: "127.0.0.1", port: 53, type: "udp" },
            timeout: 2000
        });

        req.on("timeout", function(){
            return fn();
        });

        req.on("message", function (err, answer) {
            var addresses = [];
            answer.answer.forEach(function(a){
                addresses.push(a.address);
            });

            return fn(null, _.first(addresses));
        });

        req.send();
    }
}, function(err, zookeeper){
    _.merge(zookeeper, process.env);

    _.defaults(zookeeper, {});

    var options = {
        url: ["http:/", [zookeeper.CLUSTER_LEADER, "8080"].join(":"), "v1", "hosts"].join("/"),
        method: "GET",
        json: true,
        timeout: 5000
    }

    async.waterfall([
        function(fn){
            request(options, function(err, response){
                if(err)
                    return fn(err);
                else if(response && response.statusCode != 200)
                    return fn(new Error("Received non-200 status code from leader!"));
                else{
                    var hosts = _.values(response.body);

                    hosts = _.filter(hosts, { mode: "follower" });

                    var this_host = _.find(hosts, function(host){
                        return host.host_name == os.hostname();
                    });

                    hosts = _.filter(hosts, function(host){
                        return host.host_name != os.hostname();
                    });

                    var count = 1;

                    var files = {

                        zoo_cfg: _.flatten([
                            "tickTime=2000",
                            "initLimit=10",
                            "syncLimit=5",
                            "dataDir=/tmp/zookeeper",
                            "clientPort=2181",
                            ["server.", this_host.address.private.split(".").join(""), "=" , this_host.address.private, ":2888:3888"].join(""),
                            _.map(hosts, function(host){
                                count++;
                                return ["server.", host.address.private.split(".").join(""), "=", host.address.private, ":2888:3888"].join("");
                            })
                        ]).join("\n"),

                        my_id: this_host.address.private.split(".").join("")
                    }

                    return fn(null, files);
                }
            });
        },
        function(files, fn){
            async.parallel([
                function(fn){
                    fs.writeFile("/opt/zookeeper/conf/zoo.cfg", files.zoo_cfg, fn);
                },
                function(fn){
                    fs.writeFile("/tmp/zookeeper/myid", files.my_id, fn);
                }
            ], fn);
        },
    ], function(err){
        if(err){
            process.stderr.write(err.message);
            process.exit(1);
        }

        var proc = child_process.spawn(["", "opt", "zookeeper", "bin", "zkServer.sh"].join("/"), [ "start-foreground" ]);

        proc.stdout.pipe(process.stdout);
        proc.stderr.pipe(process.stderr);

        proc.on("error", function(err){
            process.stderr.write(err.message);
            process.exit(1);
        });
    });

});

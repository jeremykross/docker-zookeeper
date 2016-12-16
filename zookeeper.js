'use strict';

const _ = require('lodash');
const async = require('async');
const child_process = require('child_process');
const dns = require('native-dns');
const fs = require('fs');
const os = require('os');
const request = require('request');

async.parallel({
    CLUSTER_LEADER: (fn) => {
        const question = dns.Question({
          name: ['leaders', process.env.CS_CLUSTER_ID, 'containership'].join('.'),
          type: 'A'
        });

        const req = dns.Request({
            question: question,
            server: { address: '127.0.0.1', port: 53, type: 'udp' },
            timeout: 2000
        });

        req.on('timeout', () => {
            return fn();
        });

        req.on('message', (err, answer) => {
            const addresses = [];
            answer.answer.forEach((a) => {
                addresses.push(a.address);
            });

            return fn(null, _.first(addresses));
        });

        req.send();
    }
}, (err, zookeeper) => {
    _.merge(zookeeper, process.env);

    _.defaults(zookeeper, {});

    const options = {
        url: ['http:/', [zookeeper.CLUSTER_LEADER, '8080'].join(':'), 'v1', 'hosts'].join('/'),
        method: 'GET',
        json: true,
        timeout: 5000
    }

    async.waterfall([
        (fn) => {
            request(options, (err, response) => {
                if(err)
                    return fn(err);
                else if(response && response.statusCode != 200)
                    return fn(new Error('Received non-200 status code from leader!'));
                else{
                    let hosts = _.values(response.body);

                    hosts = _.filter(hosts, { mode: 'follower' });

                    const this_host = _.find(hosts, (host) => {
                        return host.host_name == os.hostname();
                    });

                    hosts = _.filter(hosts, (host) => {
                        return host.host_name != os.hostname();
                    });

                    let count = 1;

                    const files = {
                        zoo_cfg: _.flatten([
                            'tickTime=2000',
                            'initLimit=10',
                            'syncLimit=5',
                            'dataDir=/tmp/zookeeper',
                            'clientPort=2181',
                            ['server.', this_host.address.private.split('.').join(''), '=' , this_host.address.private, ':2888:3888'].join(''),
                            _.map(hosts, (host) => {
                                count++;
                                return ['server.', host.address.private.split('.').join(''), '=', host.address.private, ':2888:3888'].join('');
                            })
                        ]).join('\n'),

                        my_id: this_host.address.private.split('.').join('')
                    }

                    return fn(null, files);
                }
            });
        },
        (files, fn) => {
            async.parallel([
                (fn) => {
                    fs.writeFile('/opt/zookeeper/conf/zoo.cfg', files.zoo_cfg, fn);
                },
                (fn) => {
                    fs.writeFile('/tmp/zookeeper/myid', files.my_id, fn);
                }
            ], fn);
        },
    ], (err) => {
        if(err){
            process.stderr.write(err.message);
            process.exit(1);
        }

        const proc = child_process.spawn(['', 'opt', 'zookeeper', 'bin', 'zkServer.sh'].join('/'), [ 'start-foreground' ]);

        proc.stdout.pipe(process.stdout);
        proc.stderr.pipe(process.stderr);

        proc.on('error', (err) => {
            process.stderr.write(err.message);
            process.exit(1);
        });
    });

});

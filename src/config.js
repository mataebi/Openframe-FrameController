/**
 * Configuration module
 */

var jsonfile = require('jsonfile'),
    debug = require('debug')('openframe:config'),
    ofrc_file,

    config = module.exports = {};
/**
 * try to detect the device platform (i.e. linux, mac, windows)
 * @return {String} the platform
 */
/*
function getPlatform() {
    debug(process.platform);

    if (/^linux/.test(process.platform)) {
        return 'linux';
    } else if(/^darwin/.test(process.platform)) {
        return 'mac';
    } else {
        return 'windows';
    }
}
*/

config.getUserHome = function() {
    return process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'];
};

config.getOpenframeDir = function() {
    return config.getUserHome() + '/.openframe';
};

ofrc_file = config.getOpenframeDir() + '/.ofrc';

config.ofrc = {};

config.save = function() {
    debug('save');
    var self = this,
        p = new Promise(function(resolve, reject) {
            jsonfile.writeFile(ofrc_file, self.ofrc, {
                spaces: 2
            }, function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(self.ofrc);
            });
        });

    return p;
};

config.load = function() {
    debug('load');
    var self = this,
        p = new Promise(function(resolve, reject) {
            jsonfile.readFile(ofrc_file, function(err, ofrc) {
                if (err) {
                    console.log("Can not read configuration from "+ofrc_file+"\n"+ err);
                    reject(err);
                    return;
                }
                self.ofrc = ofrc;

                // attach full api_url to the config
                // var network = self.ofrc.network;
                // network.api_url = network.api_protocol + '://' + network.api_domain + ':' + network.api_port;

                resolve(self.ofrc);
            });
        });

    return p;
};

/**
 * The main controller for the frame.
 */

// app dependencies
var url = require('url'),
    path = require('path'),
    debug = require('debug')('openframe:frame_controller'),
    Swagger = require('swagger-client'),

    downloader = require('./downloader'),
    pubsub = require('./pubsub'),
    proc_man = require('./process-manager'),
    ext_man = require('./extension-manager'),
    config = require('./config'),
    frame = require('./frame'),
    user = require('./user'),
    rest = require('./rest'),
    Spinner = require('cli-spinner').Spinner,
    spinner = new Spinner('[%s]'),
    https = require('https'),
    requireg = require('requireg'),
    chalk = require('chalk');

var fc = {};

module.exports = fc;

/**
 * Initialize the frame controller
 * - login user
 * - connect frame
 * - update frame
 * - update extensions
 * - if necessary, install extensions
 * - init extensions
 */
fc.init = function() {
    debug('init');

    console.log('\n');
    spinner.setSpinnerString(1);
    spinner.start();

    this.login()
        .then(this.connect)
        .then(this.ready)
        .catch(function(err) {
            debug(err);
        });
};

/**
 * Install a extension.
 * - login user
 * - pull latest frame state
 * - install extension package
 * - add extension to frame.extensions
 * - exit with user-facing success/error message
 *
 * @param  {String} extension An npm-style dependency string (package[@version]);
 */
fc.installExtension = function(extension) {
    debug('installExtension', extension);
    
    var _this = this;

    var extensionParts = extension.split('@'),
        packageName = extensionParts[0],
        version = extensionParts.length > 1 ? extensionParts[1] : undefined,
        npmRepo;
        
    if (extension.startsWith('github:')) {
    	debug('github extension')    
      var repoPath = extension.replace(/^(github:)/,'').split('#')[0];
      var branch = extension.split('#')[1] || 'master';
      debug('branch', branch);
      var packageJsonURL = 'https://raw.githubusercontent.com/' + repoPath + '/' + branch + '/package.json';
    	debug('packageJsonURL', packageJsonURL);
      
      var result = '';

      https.get(packageJsonURL, function(response) {
    		if (response.statusCode != 200) debug('Couldn\'t download package.json from Github')	
    			
        response.on('data',d => result += d).on('end',() => {
    			var packageJson = JSON.parse(result);
    			
    			version = undefined;
    		  packageName = packageJson.name;
          npmRepo = extension
    			
    			_install();
    		});
      }).on('error', (e) => {
    	  debug(e);
    	});	
  	} 
    else if (extension.startsWith('file:')) {
      debug('extension on local filesystem')    

      var repoPath = extension.replace(/^(file:)/,'')
      
      var packageJson = require(path.join(repoPath,'package.json'));
      
      version = undefined;
      packageName = packageJson.name;
      npmRepo = extension
      
      _install();
    
    } 
    else {
      debug('regular extension')  
      npmRepo = packageName  
    	_install();
    }
    
    function _install() {
    	debug('packageName',packageName)
    	debug('version', version)

      _this.login()
          .then(function() {
              frame.fetch()
                  .then(function() {
                      ext_man.installExtension(npmRepo, version, true)
                          .then(function() {
                              debug('Installed ' + extension + ' successfully, saving frame...');
                              var ext = requireg(packageName, true); // Make sure to check for installed extensions globally and skip local packages 
                              // successfully installed extension locally, add to frame
                              frame.state.extensions[packageName] = version || "*";
                              frame.state.settings = frame.state.settings || {};
                              frame.state.settings[packageName] = ext.props.settings || {};
                              debug('EXT', ext);
                              debug('SETTINGS', frame.state.settings);
                              frame.save()
                                  .then(function() {
                                      console.log('[o]   Extension installed successfully!\n');
                                  });
                          });
                  })
                  .catch(function(err) {
                      if (err.status === 404) {
                          console.log('[o]   ERROR: This frame has been set up perviously, but is not attached this user.');
                          console.log('\n');
                          console.log('To reset the frame entirely, restart using: openframe -r');
                      }
                  });
          });
    };
};

/**
 * Uninstall a extension.
 * - login user
 * - pull latest frame state
 * - uninstall extension package
 * - remove extension to frame.extensions
 * - exit with user-facing success/error message
 *
 * @param  {String} extension name (npm package);
 */
fc.uninstallExtension = function(packageName) {
    debug('uninstallExtension', packageName);

    this.login()
        .then(function() {
            frame.fetch()
                .then(function() {
                    ext_man.uninstallExtension(packageName)
                        .then(function() {
                            debug('Uninstalled ' + packageName + ' successfully, saving frame...');
                            // successfully installed extension locally, add to frame
                            if (packageName in frame.state.extensions) {
                                delete frame.state.extensions[packageName];
                            }
                            if (packageName in frame.state.settings) {
                                delete frame.state.settings[packageName];
                            }
                            frame.save()
                                .then(function(resp) {
                                    // debug(resp);
                                    console.log('[o]   Extension uninstalled successfully!\n');
                                });
                        }).catch(function(err) {
                            console.log('[o]   ERROR: Problem uninstalling the extension. Are you sure it is installed?\n');
                        });
                })
                .catch(function(err) {
                    if (err.status === 404) {
                        console.log('[o]   ERROR: This frame has been set up perviously, but is not attached this user.');
                        console.log('\n');
                        console.log('To reset the frame entirely, restart using: openframe -r');
                    }
                });
        });
};

/**
 * Called when the frame has finished initializing.
 */
fc.ready = function() {
    debug('ready');
    spinner.stop(true);

    if (frame.state && frame.state.current_artwork) {
        fc.changeArtwork();
    } else {
        var url = config.ofrc.network.app_base;

        // No current artwork... give the user a message:
        console.log('[o]   Connected! You can now push artwork to this frame.');
        console.log('\n');
        console.log('This frame should now appear as ' + frame.state.name + ' when you log in to Openframe at ' + url + '.');
        console.log('\n');
    }
};


/**
 * Authenticate with the API server using the supplied user/pass.
 *
 * @return {Promise} A promise resolving with the logged-in user's ID
 */
fc.login = function() {
    debug('login');

    var creds = user.state;
    return new Promise(function(resolve, reject) {
        rest.client.OpenframeUser.OpenframeUser_login({
            credentials: creds
        }).then(function(resp) {
            if (resp.obj.id) {
                creds.access_token = resp.obj.id;
                rest.client.clientAuthorizations.add('access_token', new Swagger.ApiKeyAuthorization('access_token', resp.obj.id, 'query'));
            }
            rest.client.OpenframeUser.OpenframeUser_cfg().then(function(conf_resp) {
                debug(resp);
                config.ofrc.pubsub_url = conf_resp.obj.config.pubsub_url;
                config.save().then(function() {
                    resolve(resp.obj.userId);
                });
            });
        }).catch(function(err) {
            // login failed...
            debug('Login failed. Please try again.');
            spinner.stop(true);
            console.log('[o]   Login failed. Please try again.');
            console.log('\n');
            user.state = {};
            user
                .save()
                .then(function() {
                    process.exit(0);
                });
        });
    });
};

/**
 * Connect this Frame. If the Frame has not yet been created, i.e. there is no
 * id on the Frame object in ofrc, create a new Frame.
 *
 * @param  {String} userId
 * @return {Promise}
 */
fc.connect = function(userId) {
    debug('connect', userId);

    return new Promise(function(resolve, reject) {
        // called when frame is ready to connect
        function readyToConnect() {
            debug('readyToConnect');
            fc.pubsub = pubsub.init(fc);
            resolve();
        }

        // XXX - POTENTIAL BUG - catch extension init error separately, otherwise a new frame is created.
        frame
            .fetch()
            .then(readyToConnect)
            .then(function() {
                debug('ready to init...');
                // initExtensions now always resolves, is never rejected
                return ext_man.initExtensions(frame.state.extensions, fc.extensionApi);
            })          
            .catch(function(err) {
                debug(err);
                fc.registerNewFrame(userId)
                    .then(readyToConnect)
                    .catch(function(err) {
                        debug(err);
                        reject(err);
                    });
            });
    });
};

/**
 * Register this as a new frame for user [userId]. This creates a new
 * Frame object on the server via the REST api.
 *
 * TODO: should this be on the frame model? a create method?
 *
 * @param  {String} userId
 * @return {Promise} A promise resolving with the newly created Frame object
 */
fc.registerNewFrame = function(userId) {
    debug('registerNewFrame', userId);

    return new Promise(function(resolve, reject) {
        rest.client.OpenframeUser.OpenframeUser_prototype_create_owned_frames({
            data: {
                name: frame.state.name
            },
            id: userId
        }).then(function(data) {
            debug(data.obj);
            frame.state = data.obj;
            frame.persistStateToFile();
            ext_man.installExtensions(frame.state.extensions)
                .then(function() {
                    debug('-----> extensions installed');
                    ext_man.initExtensions(frame.state.extensions, fc.extensionApi)
                        .then(function() {
                            resolve(frame.state);
                        });
                })
                .catch(function(err) {
                    reject(err);
                });
        }).catch(function(err) {
            debug(err);
            reject(err);
        });
    });
};

/**
 * Change the artwork being displayed to that which is stored in the
 * Frame's current_artwork.
 */
fc.changeArtwork = function() {
    debug('changeArtwork', frame.state.current_artwork);

    var old_artwork = fc.current_artwork || undefined,
        new_artwork = frame.state.current_artwork,
        old_format = old_artwork && frame.formats[old_artwork.format],
        new_format = frame.formats[new_artwork.format],
        new_artwork_conf = new_artwork.config || {},
        tokens = {},
        parsed, file_name;

    debug('artwork details', old_artwork, old_format, new_artwork, new_format);

    return new Promise(function(resolve, reject) {

        // artwork extension not installed, don't update
        if (!new_format) {
            console.error(chalk.red('The artwork format is not installed: ' + new_artwork.format + '\n'));
            return reject();
        }

        if (old_artwork) {
          // old_artwork contains the "tokens" object which never
          // exists in new_artwork so remove it before compairing
          const { tokens, ...old_artwork_tmp } = old_artwork;
          debug('tmp artwork details', old_artwork_tmp, new_artwork);

          // if old artwork is new artwork, don't update.
          if (JSON.stringify(old_artwork_tmp) === JSON.stringify(new_artwork)) {
              debug('new artwork same as current', old_artwork.id, new_artwork.id);
              return reject();
          }        
        }

        function swapArt() {
            debug('swapArt');
            if (old_artwork) {
                _endArt(old_format, old_artwork)
                    .then(function() {
                        _startArt(new_format, new_artwork).then(function() {
                            fc.current_artwork = new_artwork;
                            fc.pubsub.publish('/frame/'+frame.state.id+'/frame_updated', frame.state.id);
                            resolve();
                        });
                    })
                    .catch(reject);
            } else {
                _startArt(new_format, new_artwork).then(function() {
                    fc.current_artwork = new_artwork;
                    resolve();
                });
            }
        }

        if (new_format.download) {
            debug('download');
            // this artwork needs to be downloaded
            parsed = url.parse(new_artwork.url);
            file_name = path.basename(parsed.pathname);

            downloader.downloadFile(new_artwork.url, new_artwork.id + file_name, file_name)
                .then(function(filePath) {
                    tokens['$url'] = new_artwork.url;
                    tokens['$id'] = new_artwork.id;
                    tokens['$filepath'] = filePath;
                    tokens['$filename'] = file_name;
                    new_artwork.tokens = tokens;
                    swapArt();
                })
                .catch(reject);
        } else {
            debug('DO NOT download');
            // this artwork can be displayed via the url
            tokens['$url'] = new_artwork.url;
            new_artwork.tokens = tokens;
            swapArt();
        }

    });
};

fc.updateFrame = function() {
    // let subscribers know the frame is updating
    fc.pubsub.publish('/frame/'+frame.state.id+'/frame_updating', frame.state.id);

    // fetch the latest frame state, and update as needed
    frame.fetch()
        .then(function(new_state) {
            if (frame.state.current_artwork) {
                fc.changeArtwork()
                    .then(function() {
                        // success changing artwork, do nothing more...
                    })
                    .catch(function() {
                        // error changing artwork, reset frame.state.current_artwork to true current
                        frame.state.current_artwork = fc.current_artwork;
                    });
            }
        });
};

/**
 * A sandboxed API passed into extensions' init function.
 * @type {Object}
 */
fc.extensionApi = {
    // let the extension add a format to the frame
    addFormat: frame.addFormat,
    // give the extension access to the global pubsub
    getPubsub: function() {
        return fc.pubsub;
    },
    // access to the Swagger rest client
    getRest: function() {
        return rest.client;
    },
    // access to the frame model reference
    getFrame: function() {
        return frame;
    }
};

/**
 * Start an artwork.
 * @param  {string} new_format
 * @param  {object} new_artwork
 * @return {Promise}
 */
function _startArt(new_format, new_artwork) {
    debug('startArt');
    var _command = new_format.start_command,
        tokens = new_artwork.tokens || {};
    if (typeof _command === 'function') {

        // we're passing artwork-specific args and tokens here, letting the format
        // construct the command dynamically...
        var options = new_artwork.options || {};
        _command = _command.call(new_format, options, tokens);
        
        // start_command of the extension can return either Promise or a value, both is okay.
        return Promise.resolve(_command).then(function(value) {
          return new Promise(function(resolve, reject) {
            _command = value
            
            resolve(replaceTokensAndStart())
          })
        })
        
    }
    else {
      return replaceTokensAndStart()
    } 
    
    function replaceTokensAndStart() {
      var command = _replaceTokens(_command, tokens);

      return new Promise(function(resolve, reject) {
          // TODO: proc_man.startProcess doesn't return Promise
          // can we know when the process is ready without ipc?
          proc_man.startProcess(command);
          resolve();
      }); 
    }
}

/**
 * End a playing artwork.
 * @param  {string} old_format
 * @param  {object} old_artwork
 * @return {Promise} Resolves when command is complete.
 */
function _endArt(old_format, old_artwork) {
    debug('endArt');
    var _command = old_format.end_command,
        tokens = old_artwork.tokens || {};
    if (typeof _command === 'function') {

        // we're passing artwork-specific args and tokens here, letting the format
        // construct the command dynamically...
        var options = old_artwork.options || {};
        _command = _command.call(old_format, options, tokens);
    }
    var command = _replaceTokens(_command, tokens);
    
    return new Promise(function(resolve, reject) {
        proc_man.exec(command, function(err) {
            if (err) {
                debug(err);
            }
            resolve();
        });
    });
}

/**
 * Replace placeholder tokens in a string.
 *
 * TODO: move to a util module
 *
 * @param  {string} _str
 * @param  {object} tokens
 * @return {string} The string with tokens replaced.
 */
function _replaceTokens(_str, tokens) {
    var str = _str,
        key;
    for (key in tokens) {
        if (tokens.hasOwnProperty(key)) {
            // TODO: better token replacement (global replacement?)
            str = str.replace(key, tokens[key]);
        }
    }
    return str;
}

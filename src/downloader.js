// 'use strict';

/**
 * A small utility for downloading files.
 */

// Dependencies
const fs = require('fs'),
  request = require('request'),
  progress = require('request-progress'),
  mkdirp = require('mkdirp'),
  path = require('path'),
  logSingleLine = require('single-line-log').stdout,
  debug = require('debug')('openframe:downloader'),
  status = require('http-status'),
  prettyBytes = require('pretty-bytes'),
  humanizeDuration = require('humanize-duration'),
  chalk = require('chalk'),
  config = require('./config'),
  sprintf = require('sprintf-js').sprintf;
const { exec } = require('child_process');

const artworkDir = '/tmp';

let artworkRequest, finished = false
    
/**
 * Download a file using HTTP get.
 *
 * @param  {String}   file_url
 * @param  {String}   file_output_name
 */
function downloadFile(file_url, file_output_name) {
  debug('downloading %s', file_url);
  
  return new Promise(function(resolve, reject) {
    var file_name = file_output_name,
        file_path = artworkDir + '/' + file_name;    

    mkdirp(artworkDir, function (err) {
        if (err) {
          console.log('Couldn\'t create artwork directory.')
          console.error(err)
        }
    });

    // debug('finished',finished)
    if (artworkRequest && !finished) artworkRequest.abort()
    finished = false 
    artworkRequest = request({ 
      url: file_url,
      headers: {
        'User-Agent': 'request'
      }
    })

    progress(artworkRequest, {
      throttle : 500
    })
    .on('response', function(response) {
      // console.log(response.statusCode)
      // console.log(response.headers['content-type'])
      if (!(/^2/.test('' + response.statusCode))) { // Status Codes other than 2xx
        console.error(
          chalk.red("The artwork is not available.\n"),
          "Server responded with this status code " + chalk.yellow(response.statusCode + " " + status[response.statusCode])
        );
        reject()
      }
    })
    .on('error', function(err) {
      console.log("Error downloading artwork")
      console.error(err)
      reject()
    })
    .on('abort', function() {
      debug("Aborted downloading artwork")
      reject()
    })
    .on('progress', function (state) {
        if (debug.enabled) {
          if (state.size.total) logSingleLine((state.percent*100).toFixed(2) + '% of ' + prettyBytes(state.size.total)+ ' – ' + humanizeDuration(state.time.remaining * 1000, { round: true }) + ' remaining – ' + (state.speed != null ? prettyBytes(state.speed) : '?') + '/s')
          else logSingleLine('Total download size unkown')
        }
    })
    .pipe(fs.createWriteStream(file_path).on("error", function(err) {
      console.log("Error saving artwork")
      console.log(err)
      reject()
    }))
    .on('finish', function() {
      debug('Artwork downloaded')
      finished = true

      // configure the upload info at ~/.openframe/.ofrc
      const upload_url = config.ofrc.upload.url;
      const upload_secret = config.ofrc.upload.secret;

      // If upload_url and upload_secret are defined, try to upload the file just downloaded to the server specified by upload_url
      if (typeof upload_url !== 'undefined' && typeof upload_secret !== 'undefined') {
        // Try to get the filename based on the extension used
        const match = file_url.match(/([^/?&=]+\.(gif|gifv|mp4|png|jpg|jpeg))/i);

        // If the filename was not found use the local download name
        const upload_filename = match ? match[1] : file_name;

        // Create the curl command needed for the upload
        // const curlcmd = sprintf("curl -s -L -k -T %s -u '%s:' -H 'X-Requested-With: XMLHttpRequest' %s/%s", file_path, upload_secret, upload_url, upload_filename);
        const curlcmd = sprintf("curl -s -L -k -T %s -u '%s:' -H 'X-Requested-With: XMLHttpRequest' %s/%s", file_path, upload_secret, upload_url, file_output_name);

        // Try to execute the command
        console.log("Trying to upload using: %s", curlcmd);
        exec(curlcmd, (error, stdout, stderr) => {
          if (error) {
            console.log(`Upload execution error: ${error.message}`);
          } else if (stderr) {
            console.log(`Upload execution error: ${stderr}`);
          } else if (stdout) {
            console.log(`Upload command returns: ${stdout}`);
          } else {
            console.log('Upload of ' + upload_filename + ' executed successfully');
          }
        });
      } // if upload

      return resolve(file_path);
    });
  });
}

exports.downloadFile = downloadFile;

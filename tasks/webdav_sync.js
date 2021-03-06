/*
 * grunt-webdav-sync
 * https://github.com/avisi/grunt-webdav-sync
 *
 * Copyright (c) 2013 Avisi B.V.
 * Licensed under the MIT license.
 */

'use strict';

var http = require("http");
var path = require("path");
var url = require('url');
var async = require('async');
var request = require('request');

var createRequestOptions = function(remoteURL, method) {
    var parsedUrl = url.parse(remoteURL);
    var auth = parsedUrl.auth; 

    if(auth !== null) {
        var splittedString = auth.split(":");
        auth = {
            user: splittedString[0],
            pass: splittedString[1],
            sendImmediately: false   
        };
    }

    var options = {
        uri: parsedUrl,
        method: method,
        auth: auth
    }; 

    options.uri.auth = "";

    return options
};

var deleteFolderOnRemote = function(grunt, remoteURL, callback) {
    grunt.verbose.writeln("Deleting folder: " + remoteURL); 

    var options = createRequestOptions(remoteURL, 'DELETE');

    request(options, function(error, res, body) {
        if(res.statusCode === 204 || res.statusCode === 404) { //created
            grunt.verbose.writeln("Folder: " + remoteURL + " deleted");
            callback(null, remoteURL);
        } else if (res.statusCode === 423) {
            callback({status: res.statusCode, message: "Could not remove the locked folder For url: " + remoteURL}, null);
        } else {
            callback({status: res.statusCode, message: "Unknown error while deleting a dir gave statuscode: " + res.statusCode}, null);
        }
    }).setMaxListeners(0);
};

var createFolderOnRemote = function(grunt, remoteURL, callback) {
    grunt.verbose.writeln("Creating folder: " + remoteURL);
    
    var options = createRequestOptions(remoteURL, 'MKCOL');
    

    request(options, function(error, res, body) {
        if(res.statusCode === 201) { //created
            grunt.verbose.writeln("Folder: " + remoteURL + " created");
            callback(null, remoteURL);
        } else if (res.statusCode === 401) {
            callback({status: res.statusCode, message: "Resource requires authorization or authorization was denied. For url: " + remoteURL}, null);
        } else if (res.statusCode === 403) {
            callback({status: res.statusCode, message: "The server does not allow collections to be created at the specified location, or the parent collection of the specified request URI exists but cannot accept members."}, null);
        } else if (res.statusCode === 405) {
            grunt.verbose.writeln("Folder already exists : " + remoteURL);
            callback(null, remoteURL);
        } else if (res.statusCode === 409) {
            callback({status: res.statusCode, message: "A resource cannot be created at the destination URI until one or more intermediate collections are created. For url: " + remoteURL}, null);
        } else if (res.statusCode === 415) {
            callback({status: res.statusCode, message: "The request type of the body is not supported by the server."}, null);
        } else if(res.statusCode === 409) {
            callback({status: res.statusCode, message: "The destination resource does not have sufficient storage space."}, null);
        } else {
            callback({status: res.statusCode, message: "Unknown error while uploading a dir."}, null);
        }
    });
};

var createFileOnRemote = function(grunt, remoteURL, data, callback) {
    grunt.verbose.writeln("Creating file: " + remoteURL);
    
    var options = createRequestOptions(remoteURL, 'PUT', data);

    options.body = data;

    request(options, function(error, res, body) {
        if(res.statusCode === 500) {
            grunt.log.error("Got a unkown error trying to upload a file to: " + remoteURL);
            callback({message: "Error got a " + res.statusCode + " Trying to upload a file to: " + remoteURL}, null);
        } else if (res.statusCode === 401) {
            grunt.log.error("Resource requires authorization or authorization was denied. For url:  " + remoteURL);
            callback({status: res.statusCode, message: "Resource requires authorization or authorization was denied. For url: " + remoteURL}, null);
        } else {
            grunt.verbose.writeln("File: " + remoteURL + " created");
            callback(null, remoteURL);
        }
    });

    
};

var getUploadKey = function(filePath, localPath) {
    return path.relative(localPath, filePath);
};

var getParentUploadKey = function(uploadKey) {
    var pathParts = uploadKey.split(path.sep);
    if(pathParts.length > 1) {
        pathParts.splice(pathParts.length - 1, 1);
        return pathParts.join(path.sep);
    }
    return false;
};

var createTask = function(parent, func) {
    if(parent === false) {
        return function(callback) {
            func(callback);
        };
    } else {
        return [parent, function(callback) {
            func(callback);
        }];
    }
};


module.exports = function(grunt) {

    grunt.registerMultiTask('webdav_sync', 'Synchronizes a local folder to a remote webdav folder', function() {

        var done = this.async();
        grunt.log.writeln('starting webdav_sync');
        // Merge task-specific and/or target-specific options with these defaults.
        var options = this.options();
        var remote_path = options.remote_path;

        grunt.log.writeln('Searching for files in: ' + options.local_path);
        var files = grunt.file.expand(options.local_path);

        var localPath = files[0];
        files.splice(0, 1); // the first file is always the specified dir we remove it.

        grunt.log.ok('Found ' + files.length + ' files, Start uploading files to ' + options.remote_path);
        grunt.verbose.writeln(grunt.log.wordlist(files));

        var uploadTasks = {};

        files.forEach(function(file) {
            var key = getUploadKey(file, localPath);
            var parent = getParentUploadKey(key);
            var remoteURL = url.resolve(remote_path, path.relative(localPath, file).replace(/\\/g, '/'));
            var isDir = grunt.file.isDir(file);

            if(isDir) {
                // Remove existing dir and create a new one
                uploadTasks[key] = createTask(parent, function(callback) {
                    async.series([
                        function(taskCallback) {
                            deleteFolderOnRemote(grunt, remoteURL, taskCallback);    
                        },
                        function(taskCallback) {
                            createFolderOnRemote(grunt, remoteURL, taskCallback);        
                        }
                    ], function (err, results) {
                        if(err !== null) {
                            grunt.log.error(err.message);
                            callback(err);   
                        } else {
                            callback(null, remoteURL);        
                        }
                    });
                    
                });
            } else {
                var buffer = grunt.file.read(file);
                uploadTasks[key] = createTask(parent, function(callback) {

                    createFileOnRemote(grunt, remoteURL, buffer, callback);
                });

            }
        });


        async.auto(uploadTasks, function(err, results) {
            if(err !== null) {
                grunt.log.error(err.message);
                done(false);
            } else {
                done();
            }
        });

        // async.series([
        //     function(callback) {
        //         console.log(remote_path);
        //         if(url.parse(remote_path).path !== '/') {
        //             deleteFolderOnRemote(grunt, remote_path, callback);   
        //         } else {
        //             callback(null, remote_path);
        //         }
        //     },
        //     function(callback) {
        //         if(url.parse(remote_path).path !== '/') {
        //             createFolderOnRemote(grunt, remote_path, callback);       
        //         } else {
        //             callback(null, remote_path);
        //         }
                
        //     }
        // ], function (err, results) {
        //     async.auto(uploadTasks, function(err, results) {
        //         if(err !== null) {
        //             grunt.log.error(err.message);
        //             done(false);
        //         } else {
        //             done();
        //         }
        //     })
        // });

    });

};

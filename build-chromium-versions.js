#!/usr/bin/env node
/**
 * This node.js program is used to build multi-versions of chromiums.
 * This script depends on 'build-chromium.js'. You need to put both files
 * in the same directory where '.gclient' resides.
 *
 * The versions are specified by the [verMin, verMax] global varibles.
 *
 * A bootstrap repo need to be checkout in order to run this program. 
 * Please refer to the following url for instructions:
 *
 *  http://dev.chromium.org/developers/how-tos/get-the-code
 *
 */
var cp = require('child_process');
var path = require('path');
var fs = require('fs');
var colors = require('colors');


var verMin = 29;    // min version to be built
var verMax = 35;    // max version to be built
var commits = []; 

getLog();

// Gets all commits logs of 'chrome/VERSION'
function getLog() {
    var procGitLog = cp.spawn(
        'git',
        ['--no-pager', 'log', '--color=never', '--pretty=format:commit:%H', '-U0', 'origin/lkgr', 'chrome/VERSION'],
        {cwd: 'src', stdio: ['ignore', 'pipe', process.stderr]}
    );
    var log = '';
    procGitLog.stdout.setEncoding('utf8');
    procGitLog.stdout.on('data', function (data) {
        log += data;
    });
    procGitLog.on('exit', function (code, signal) {
        if (!signal) {
            if (code) { // w/ error, exit
                console.log('[Error]: %s', 'git log failed');
                process.exit(1);
            }
            else { // succeeded
                //console.log(log);
                search(log);
            }
        }
    });
}

// Searches the log for commits with changes to 'MAJOR='
function search(log) {
    var logs = log.split('\n');
    var c;

    logs.forEach(function (e) {
        var m = e.match(/commit:(\w+)/);
        if (m) {
            c = m[1];
        } else if (m = e.match(/\+MAJOR=(\d+)/)) {
            var major = parseInt(m[1]);
            if (verMin <= major && major <= verMax) {
                commits.push({'commit': c, 'major': major});
            }
        } 
    });

    console.log(JSON.stringify(commits).replace(/\}\,\{/g, '},\n{').yellow);
    srcGitReset();
}

// Let's clean up 'src' thoroughly
function srcGitReset() {
    console.log("Starting 'git reset' in 'src'".blue);
    var procGit = cp.spawn(
        'git',
        ['reset', '-q', '--hard', 'HEAD'],
        {cwd: 'src', stdio: 'inherit'}
    );
    procGit.on('exit', function (code, signal) {
        if (!signal) {
            if (code) { // w/ error, exit
                console.log('[Error]: %s', 'git reset failed');
                process.exit(1);
            }
            else { // succeeded
                console.log("Ended 'git reset' in 'src'".green);
                srcGitClean();
            }
        }
    });
}

function srcGitClean() {
    console.log("Starting 'git clean' in 'src'".blue);
    var procGit = cp.spawn(
        'git',
        ['clean', '-fdq'],
        {cwd: 'src', stdio: 'inherit'}
    );
    procGit.on('exit', function (code, signal) {
        if (!signal) {
            if (code) { // w/ error, exit
                console.log('[Error]: %s', 'git clean failed');
                process.exit(1);
            }
            else { // succeeded
                console.log("Ended 'git clean' in 'src'".green);
                checkout();
            }
        }
    });
}

// Checks out a commit
function checkout() {
    console.log("Starting 'git checkout' at 'src'".blue);
    var c = commits.shift();
    var procGitCheckout = cp.spawn(
        'git',
        ['checkout', c.commit],
        {cwd: 'src', stdio: 'inherit'}
    );
    procGitCheckout.on('exit', function (code, signal) {
        if (!signal) {
            if (code) { // w/ error, exit
                console.log('[Error]: %s', 'git checkout failed');
                process.exit(1);
            }
            else { // succeeded
                console.log("Ended 'git checkout' at 'src'".green);
                depsGitReset(); // clean up the deps of the new checkout to satisfy sync().
            }
        }
    });
}


// Cleans up all the deps
function depsGitReset() {
    console.log("Starting 'gclient recurse git reset' at 'src'".blue);
    var procGit = cp.spawn(
        'gclient',
        ['recurse', 'git', 'reset', '-q', '--hard', 'HEAD'],
        {cwd: 'src', stdio: 'inherit'}
    );
    procGit.on('exit', function (code, signal) {
        if (!signal) {
            if (code) { // w/ error, exit
                console.log('[Error]: %s', 'gclient recurse failed');
                process.exit(1);
            }
            else { // succeeded
                console.log("Ended 'gclient recurse git reset' at 'src'".green);
                depsGitClean();
            }
        }
    });
}

function depsGitClean() {
    console.log("Starting 'gclient recurse git clean' at 'src'".blue);
    var procGit = cp.spawn(
        'gclient',
        ['recurse', 'git', 'clean', '-dfq'],
        {cwd: 'src', stdio: 'inherit'}
    );
    procGit.on('exit', function (code, signal) {
        if (!signal) {
            if (code) { // w/ error, exit
                console.log('[Error]: %s', 'gclient recurse failed'.green);
                process.exit(1);
            }
            else { // succeeded
                console.log("Ended 'gclient recurse git clean' at 'src'");
                sync();
            }
        }
    });
}

// sync 
function sync() {
    console.log("Starting 'gclient sync' at 'src'".blue);
    var procGclientSync = cp.spawn(
        'gclient',
        ['sync', '--nohooks'],
        {cwd: 'src', stdio: 'inherit'}
    );
    procGclientSync.on('exit', function (code, signal) {
        if (!signal) {
            if (code) { // w/ error, exit
                console.log('[Error]: %s', 'gclient sync failed');
                process.exit(1);
            }
            else { // succeeded
                console.log("Ended 'gclient sync' at 'src'".green);
                build();
            }
        }
    });
}

// Calls './build-chromium.js' to build, and after complete, will iterate the next commit.
function build() {
    var procBuild = cp.fork(
        './build-chromium.js',
        [],
        {cwd: ''}
    );
    procBuild.on('exit', function (code, signal) {
        if (!signal) {
            if (code) { // w/ error, exit
                console.log('[Error]: %s', './build-chromium.js failed');
                process.exit(1);
            }
            else { // succeeded
                if (commits.length > 0) {
                    srcGitReset(); // start from cleaning up of the current checkout
                }
            }
        }
    });
}

    

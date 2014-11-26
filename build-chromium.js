#!/usr/bin/env node
/**
 * This node.js program is used to build multi-architectures of
 * chromium.
 *
 * This program file needs to be put in the same directory where 
 * '.gclient' resides.
 *
 * A 'builds' directory needs to be created before running this 
 * program. It is where the final built .apk files reside. You can
 * use other directory by modifyined the value of the 'releasePath'
 * glabal variable.
 *
 * The 'archs' array variable defines what architectures to be built.
 * The available values are 'arm', 'arm64', 'ia32', and 'x64'.
 *
 * Note: A bootstrap repo need to be checkout in order to run this 
 * program. Please refer to the following url for instructions:
 *
 *  http://dev.chromium.org/developers/how-tos/get-the-code
 *
 * The program also requires 'zfse':
 *
 *  https://github.com/joeyu/zfse
 *
 * Please git clone it into your 'node_modules' directory.
 *
 */
var cp = require('child_process');
var path = require('path');
var fs = require('fs');
var assert = require('assert');
var colors = require('colors');
var zfse = require('zfse/zfse.js'); // https://github.com/joeyu/zfse

var ninjaCmd = ['-C', 'out/Release', 'content_shell_apk'];
var releaseFile = 'ContentShell.apk';
var srcRoot = process.cwd();
var srcPath = srcRoot + '/src';
var gypEnvFile = srcRoot + '/chromium.gyp_env';
var releasePath = srcRoot + '/builds';          // where the builts to be copied.
var archs = ['ia32', 'arm'];    // what architectures will be built

var Commit = (function () {
    function Commit(srcPath, refspec) {
        this.srcPath = srcPath;
        this.refspec = refspec;
        this.hash = undefined;
        this.authorDate = undefined;
        this.ccp = undefined; // Cr-Commit-Position
        this.ccpNo = undefined; // # of Cr-Commit-Position
        this.version = {};
    }
    Commit.prototype.getInfo = function (callback) {
        var self = this;
        var cbArgs = Array.prototype.slice.call(arguments, 1);

        // Gets version from the 'src/chrome/VERSION' file.
        var verFile = fs.readFileSync(this.srcPath + '/chrome/VERSION', 'utf8').replace(/(\r\n|\r)/gm, '\n').replace(/[ \t]/g, '').split('\n');
        this.version.major = verFile[0].replace(/MAJOR=/, '');
        this.version.minor = verFile[1].replace(/MINOR=/, '');
        this.version.build = verFile[2].replace(/BUILD=/, '');
        this.version.patch = verFile[3].replace(/PATCH=/, '');

        var log = '';
        var procGitLog = cp.spawn(
            'git', 
            ['log', '-1', '--pretty=format:%H%n%ai%n%b'], 
            {cwd: this.srcPath, stdio: ['ignore', 'pipe', process.stderr]}
        );
        procGitLog.stdout.setEncoding('utf8');
        procGitLog.stdout.on('data', function (data) {
            log += data;
        });
        procGitLog.on('exit', function (code, signal) {
            if (!signal) { // program exits normally
                if (code) { // w/ error, exit
                    process.exit(1);
                    console.error('[ERROR]: %s', 'git log failed'.red);
                }
                else { // succeeded
                    log = log.split('\n');
                    self.hash = log.shift();
                    self.authorDate = new Date(log.shift());
                    log.some(function(e) {
                        var m = e.match(/Cr-Commit-Position:\s+(.+@\{#(\d+)\})/);
                        if (m) {
                            self.ccp = m[1];
                            self.ccpNo = parseInt(m[2], 10);
                            return true;
                        } 
                    });
                    console.log(self);
                    if (callback) {
                        callback.apply(this, cbArgs);
                    }
                }
            }
        });
    }
    return Commit;
})();

var head = new Commit(srcPath);
//head.getLog();
head.getInfo(prepareBuild, archs.shift());


function prepareBuild(arch) {
    console.log("[INFO] Starting to configure '%s'".blue, arch);
    var outDir = srcPath +'/out';

    // Remove the 'src/out'
    if (fs.existsSync(outDir)) {
        zfse.rrmdir(outDir);
        console.log("[INFO] '%s' is removed!", outDir);
    }
    else {
        console.log("[INFO] '%s' doesn't exist!", outDir);
    }
    if (fs.writeFileSync(gypEnvFile, "{ 'GYP_DEFINES': 'OS=android target_arch=" + arch + "', }")) {
        console.log("[ERROR] '%s' can't be created!", gypEnvFile);
        process.exit(2); // file system error
    }

    var procGclientRunhooks = cp.spawn(
        'gclient',
        ['runhooks'],
        {cwd: srcPath, stdio: 'inherit'}
    );
    procGclientRunhooks.on('exit', function (code, signal) {
        if (!signal) {
            if (code) { // w/ error, exit
                console.log('[Error]: %s', 'gclient runhooks failed');
                process.exit(1);
            }
            else { // succeeded
                build(arch);
            }
        }
    });
}

function build(arch) {
    console.log("[INFO] Starting to build '%s'".blue, arch);
    var procBuild = cp.spawn(
        'ninja',
        ninjaCmd,
        {cwd: srcPath, stdio: 'inherit'}
    );
    procBuild.on('exit', function (code, signal) {
        if (!signal) {
            if (code) { // w/ error, exit
                console.log('[Error]: %s', 'build failed');
                process.exit(1);
            }
            else { // succeeded
                copyBuild();
            }
        }
    });
}


function copyBuild() {
    var arch = fs.readFileSync(gypEnvFile, 'utf8').replace(/(\r\n|\r|\n)/gm, ' ').replace(/^.+target_arch=(\w+).+$/, '$1');
    console.log(arch);
    var rev = head.version.major + '.' + head.version.minor + '.' + head.version.build + '.' + head.version.patch;
    if (head.ccpNo) {
      rev += '@{#' + head.ccpNo + '}'; 
    }
    var relDir = releasePath + '/' + rev;
    if (!fs.existsSync(relDir)) {
        fs.mkdirSync(relDir);
    }
    var s = srcPath + '/out/Release/apks/' + releaseFile;
    var d = relDir + '/' + path.basename(releaseFile, '.apk') + '_' + rev + '_' + arch +'.apk';
    console.log("[INFO] Copying '%s' to '%s'", s, d);
    var streamD = fs.createWriteStream(d);
    fs.createReadStream(s).pipe(streamD);
    streamD.on('finish', function () {
        // Sync the file timestamp to the commit time
        fs.utimesSync(d, head.authorDate, head.authorDate);
        if (archs.length > 0) {
            prepareBuild(archs.shift());
        }
        else {
            fs.utimesSync(relDir, head.authorDate, head.authorDate);
            process.exit(0); // all done, so exit
        }
    });
}



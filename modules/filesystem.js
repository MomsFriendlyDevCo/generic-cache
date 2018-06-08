var _ = require('lodash');
var async = require('async-chainable');
var fs = require('fs');
var fspath = require('path');
var os = require('os');

module.exports = function(settings) {
	var driver = this;

	driver.settings = _.defaults(settings, {
		filesystem: {
			path: (key, val, expiry, cb) => cb(null, fspath.join(os.tmpdir(), key + '.cache.json')),
			pathSwap: (key, val, expiry, cb) => cb(null, fspath.join(os.tmpdir(), key + '.cache.swap.json')),
		},
	});

	driver.canLoad = function(cb) {
		cb(null, true); // Filesystem module is always available
	};

	driver.set = function(key, val, expiry, cb) {
		async()
			.parallel({
				path: function(next) {
					driver.settings.filesystem.path(key, val, expiry, next);
				},
				pathSwap: function(next) {
					driver.settings.filesystem.pathSwap(key, val, expiry, next);
				},
			})
			.then(function(next) {
				fs.writeFile(this.pathSwap, JSON.stringify(val), next);
			})
			.then(function(next) { // Set the modified time to the expiry
				if (!expiry) expiry = new Date('2500-01-01'); // Set expiry to a stupid future value
				fs.utimes(this.pathSwap, expiry, expiry, next);
			})
			.then(function(next) { // Delete the original path
				fs.unlink(this.path, function(err) {
					// Purposely ignoring errors - original file probably didn't exist in the first place
					next();
				});
			})
			.then(function(next) { // Move the swap file over the original path
				fs.rename(this.pathSwap, this.path, next);
			})
			.end(function(err) {
				if (err) return cb(err);
				cb(null, val);
			});
	};

	driver.get = function(key, fallback, cb) {
		async()
			.parallel({
				path: function(next) {
					driver.settings.filesystem.path(key, null, null, next);
				},
				pathSwap: function(next) {
					driver.settings.filesystem.pathSwap(key, null, null, next);
				},
			})
			.then(function(next) { // Loop until the swap file doesn't exist
				var swapPath = this.pathSwap;
				var checkSwap = function() {
					fs.access(swapPath, function(err) {
						if (err) return next(); // Swap doesn't exist - continue on
						setTimeout(checkSwap, _.random(0, 100)); // Schedule another check at a random offset
					});
				};
				checkSwap();
			})
			.then('stats', function(next) {
				fs.stat(this.path, function(err, stats) {
					if (err) return next();
					next(null, stats);
				});
			})
			.then('isValid', function(next) {
				if (!this.stats) { // No stats - no file to read
					return next(null, false)
				} else if (this.stats.mtime < new Date()) { // Modified date is in the past - the file has expired
					fs.unlink(this.path, function(err) { // Delete the file then respond that it has expired
						next(null, false);
					});
				} else {
					next(null, true);
				}
			})
			.then('value', function(next) {
				if (!this.isValid) return next(null, fallback);

				fs.readFile(this.path, function(err, buf) {
					if (err) return next(err);
					next(null, JSON.parse(buf));
				});
			})
			.end(function(err) {
				if (err) return cb(err);
				cb(null, this.value);
			})
	};

	driver.unset = function(key, cb) {
		async()
			.then('path', function(next) {
				driver.settings.filesystem.path(key, null, null, next);
			})
			.then(function(next) {
				var path = this.path;
				fs.access(this.path, function(err) {
					if (err) return next(); // File doesn't exist anyway
					fs.unlink(path, next); // Delete file
				});
			})
			.end(cb);
	};

	driver.vacuume = function(cb) {
		// FIXME: Not currently supported
		cb();
	};

	return driver;
};

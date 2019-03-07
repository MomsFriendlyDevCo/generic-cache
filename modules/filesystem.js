var _ = require('lodash');
var async = require('async-chainable');
var fs = require('fs');
var fspath = require('path');
var mkdirp = require('mkdirp');
var os = require('os');

module.exports = function(settings, cache) {
	var driver = this;

	driver.settings = _.defaultsDeep(settings, {
		filesystem: {
			fallbackDate: new Date('2500-01-01'),
			useMemory: false,
			memoryFuzz: 200,
			path: (key, val, expiry, cb) => cb(null, fspath.join(os.tmpdir(), 'cache', key + '.cache.json')),
			pathSwap: (key, val, expiry, cb) => cb(null, fspath.join(os.tmpdir(), 'cache', key + '.cache.swap.json')),
			pathList: cb => cb(null, fspath.join(os.tmpdir(), 'cache')),
			pathFilter: (file, cb) => cb(null, file.endsWith('.cache.json')),
			pathId: (file, cb) => cb(null, fspath.basename(file, '.cache.json')),
			serialize: cache.settings.serialize,
			deserialize: cache.settings.deserialize,
		},
	});

	driver.memoryCache = {}; // If driver.settings.filesystem.useMemory is enabled this is a key/{created, value} store

	driver.canLoad = function(cb) {
		cb(null, true); // Filesystem module is always available
	};

	driver.set = function(key, val, expiry, cb) {
		var now = new Date();

		async()
			.parallel({
				path: function(next) {
					driver.settings.filesystem.path(key, val, expiry, next);
				},
				pathSwap: function(next) {
					driver.settings.filesystem.pathSwap(key, val, expiry, next);
				},
			})
			.parallel([
				function(next) {
					mkdirp(fspath.dirname(this.path), next);
				},
				function(next) {
					mkdirp(fspath.dirname(this.pathSwap), next);
				},
			])
			.then(function(next) {
				fs.writeFile(this.pathSwap, settings.filesystem.serialize(val), next);
			})
			.then(function(next) { // Set the modified time to the expiry
				if (!expiry) expiry = driver.settings.filesystem.fallbackDate; // Set expiry to a stupid future value
				fs.utimes(this.pathSwap, now, expiry, next);
			})
			.then(function(next) { // Delete the original path
				fs.unlink(this.path, err => next()) // Purposely ignore errors - original file probably didn't exist in the first place
			})
			.then(function(next) { // Move the swap file over the original path
				fs.rename(this.pathSwap, this.path, next);
			})
			.end(function(err) {
				if (err) return cb(err);
				if (driver.settings.filesystem.useMemory) driver.memoryCache[key] = {created: now, value: val};
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
					fs.access(swapPath, err => {
						if (err) return next(); // Swap doesn't exist - continue on
						setTimeout(checkSwap, _.random(0, 100)); // Schedule another check at a random offset
					});
				};
				checkSwap();
			})
			.then('stats', function(next) {
				fs.stat(this.path, (err, stats) => {
					if (err) return next();
					next(null, stats);
				});
			})
			.then('isValid', function(next) {
				if (!this.stats) { // No stats - no file to read
					return next(null, false)
				} else if (this.stats.mtime < new Date()) { // Modified date is in the past - the file has expired
					fs.unlink(this.path, err => next(null, false)); // Delete the file then respond that it has expired
					if (driver.settings.filesystem.useMemory && driver.memoryCache[key]) delete driver.memoryCache[key];
				} else {
					next(null, true);
				}
			})
			.then('value', function(next) {
				if (!this.isValid) return next(null, fallback);

				if (driver.settings.filesystem.useMemory && driver.memoryCache[key] && driver.memoryCache[key].created >= this.stats.ctime - driver.settings.filesystem.memoryFuzz) { // Use the memory cache instead of the actual file
					next(null, driver.memoryCache[key].value);
				} else { // Read the file in fresh
					fs.readFile(this.path, (err, buf) => {
						if (err) return next(err);
						next(null, settings.filesystem.deserialize(buf));
					});
				}
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
				fs.unlink(this.path, () => next()); // Delete file - ignoring errors
				if (driver.settings.filesystem.useMemory && driver.memoryCache[key]) delete driver.memoryCache[key];
			})
			.end(cb);
	};

	driver.has = function(key, cb) {
		async()
			.then('path', function(next) {
				driver.settings.filesystem.path(key, null, null, next);
			})
			.then('stats', function(next) {
				fs.stat(this.path, (err, stats) => {
					if (err) return next();
					next(null, stats);
				});
			})
			.then('isValid', function(next) {
				if (!this.stats) { // No stats - no file to read
					return next(null, false)
				} else if (this.stats.mtime < new Date()) { // Modified date is in the past - the file has expired
					fs.unlink(this.path, err => next(null, false)); // Delete the file then respond that it has expired
					if (driver.settings.filesystem.useMemory && driver.memoryCache[key]) delete driver.memoryCache[key];
				} else {
					next(null, true);
				}
			})
			.end('isValid', cb);
	};

	driver.size = function(key, cb) {
		async()
			.then('path', function(next) {
				driver.settings.filesystem.path(key, null, null, next);
			})
			.then('stats', function(next) {
				fs.stat(this.path, (err, stats) => {
					if (err) return next();
					next(null, stats);
				});
			})
			.then('size', function(next) {
				if (!this.stats) { // No stats - no file to read
					return next(null, undefined)
				} else if (this.stats.mtime < new Date()) { // Modified date is in the past - the file has expired
					fs.unlink(this.path, err => next(null, undefined)); // Delete the file then respond that it has expired
					if (driver.settings.filesystem.useMemory && driver.memoryCache[key]) delete driver.memoryCache[key];
				} else {
					next(null, this.stats.size);
				}
			})
			.end('size', cb);
	};

	driver.list = function(cb) {
		async()
			// Calculate path {{{
			.then('path', function(next) {
				driver.settings.filesystem.pathList(next);
			})
			// }}}
			// Read directory contents {{{
			.then('files', function(next) {
				fs.readdir(this.path, (err, res) => {
					if (err && err.code == 'ENOENT') {
						return next(null, []);
					} else if (err) {
						return next(err);
					} else {
						next(null, res);
					}
				});
			})
			// }}}
			.map('files', 'files', function(next, file) {
				var path = fspath.join(this.path, file);
				async()
					// Check if the file is valid {{{
					.then('isValid', function(next) {
						driver.settings.filesystem.pathFilter(path, next);
					})
					// }}}
					.parallel({
						// Extract the ID {{{
						id: function(next) {
							if (!this.isValid) return next();
							driver.settings.filesystem.pathId(path, next);
						},
						// }}}
						// Fetch the stats {{{
						stat: function(next) {
							if (!this.isValid) return next();
							fs.stat(path, function(err, stat) { // Try and read the stats - if we fail remove it from the list
								if (err) return next();
								next(null, stat);
							});
						},
						// }}}
					})
					// Compose the return entity {{{
					.end(function(err) {
						if (err) return next(err);
						if (!this.isValid || !this.stat) return next();
						next(null, {
							id: this.id,
							created: this.stat.ctime,
							expiry: this.stat.mtime,
						})
					})
					// }}}
			})
			// Fitler out invalid files {{{
			.then('files', function(next) {
				next(null, this.files.filter(file => !! file));
			})
			// }}}
			// End {{{
			.end(function(err) {
				if (err) return cb(err);
				cb(null, this.files);
			})
			// }}}
	};

	driver.destroy = function(cb) {
		cb();
	};

	return driver;
};

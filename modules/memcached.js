var _ = require('lodash');
var memcached = require('memcached');

module.exports = function(settings) {
	var driver = this;
	driver.store = {};
	driver.memcacheClient;

	driver.settings = _.defaults(settings, {
		memcached: {
			server: '127.0.0.1:11211',
			lifetime: 1000 * 60, // Default expiry if unspecified - 1 Hour
			options: {},
		},
	});

	driver.canLoad = function(cb) {
		driver.memcacheClient = new memcached(settings.memcached.server, settings.memcached.options);

		cb(null, true);
	};

	driver.set = function(key, val, expiry, cb) {
		var expiryMS = expiry ? expiry - (new Date()) : driver.settings.memcached.lifetime;

		if (expiryMS <= 0) { // Actually unset the value instead
			driver.unset(key, ()=> cb());
		} else {
			driver.memcacheClient.set(
				key,
				val,
				expiryMS,
				cb
			);
		}
	};

	driver.get = function(key, fallback, cb) {
		driver.memcacheClient.get(key, (err, val) => {
			if (err) return cb(err);
			cb(null, val !== undefined ? val : fallback);
		});
	};

	driver.unset = function(key, cb) {
		driver.memcacheClient.del(key, ()=> cb());
	};

	driver.vacuume = function(cb) {
		// Memcache automatically expires entries anyway
		cb();
	};

	return driver;
};

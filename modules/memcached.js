var _ = require('lodash');
var memcached = require('memcached');

module.exports = function(settings, cache) {
	var driver = this;
	driver.memcacheClient;

	driver.settings = _.defaults(settings, {
		memcached: {
			server: '127.0.0.1:11211',
			lifetime: 1000 * 60, // Default expiry if unspecified - 1 Hour
			options: {
				retries: 1,
				timeout: 250,
			},
			serialize: cache.settings.serialize,
			deserialize: cache.settings.deserialize,
		},
	});

	driver.canLoad = function(cb) {
		driver.memcacheClient = new memcached(settings.memcached.server, settings.memcached.options);

		// Make a dummy get request and see if it fails
		driver.memcacheClient.get('idontcare', err => cb(err, !err));
	};

	driver.set = function(key, val, expiry, cb) {
		var expiryS = Math.floor((expiry ? expiry - (new Date()) : driver.settings.memcached.lifetime) / 1000);

		if (expiryS <= 0) { // Actually unset the value instead
			driver.unset(key, ()=> cb());
		} else {
			driver.memcacheClient.set(
				key,
				settings.memcached.serialize(val),
				expiryS,
				cb
			);
		}
	};

	driver.get = function(key, fallback, cb) {
		driver.memcacheClient.get(key, (err, val) => {
			if (err) return cb(err);
			cb(null, val !== undefined ? settings.memcached.deserialize(val) : fallback);
		});
	};

	driver.unset = function(key, cb) {
		driver.memcacheClient.del(key, ()=> cb());
	};

	driver.destroy = function(cb) {
		driver.memcacheClient.end();
		cb();
	};

	return driver;
};

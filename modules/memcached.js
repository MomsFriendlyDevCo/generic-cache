var _ = require('lodash');
var memcached = require('memcached');
var debug = require('debug')('cache:memcached');

module.exports = function(settings, cache) {
	var driver = {};
	driver.memcacheClient;

	driver.settings = _.defaultsDeep(settings, {
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

	driver.canLoad = ()=> new Promise((resolve, reject) => {
		driver.memcacheClient = new memcached(settings.memcached.server, settings.memcached.options);

		// Make a dummy get request and see if it fails
		driver.memcacheClient.get('idontcare', err => err ? resolve(false) : resolve(true));
	});

	driver.set = (key, val, expiry) => new Promise((resolve, reject) => {
		var expiryS = Math.floor((expiry ? expiry - Date.now() : driver.settings.memcached.lifetime) / 1000);
		if (expiryS <= 0) {
			return driver.unset(key).then(()=> resolve(val)); // Expiry is immediate anyway - just return value and exit
		}

		driver.memcacheClient.set(
			key,
			settings.memcached.serialize(val),
			expiryS,
			err => err ? reject(err) : resolve()
		);
	});

	driver.get = (key, fallback) => new Promise((resolve, reject) => {
		driver.memcacheClient.get(key, (err, val) => {
			if (err) return reject(err);
			resolve(val !== undefined ? settings.memcached.deserialize(val) : fallback);
		});
	});

	driver.unset = key => new Promise((resolve, reject) => {
		driver.memcacheClient.del(key, err => err ? reject(err) : resolve());
	});

	driver.destroy = ()=> {
		driver.memcacheClient.end();
	};

	return driver;
};

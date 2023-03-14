var _ = require('lodash');
var redis = require('redis');
var debug = require('debug')('cache:redis');

module.exports = function(settings, cache) {
	var driver = {};

	driver.settings = _.defaultsDeep(settings, {
		serialize: cache.settings.serialize,
		deserialize: cache.settings.deserialize,

		// NOTE: Expects these params: https://github.com/redis/node-redis/blob/master/docs/client-configuration.md
		redis: {
			socket: {
				reconnectStrategy: () => undefined, // Stop after first try
			}
		},
	});

	driver.canLoad = ()=> {
		debug('canLoad', driver.settings.redis);
		driver.client = redis.createClient(driver.settings.redis);
		return driver.client.connect()
			.then(() => true)
			.catch(() => false);
	};

	driver.set = (key, val, expiry) => {
		if (!expiry) {
			return driver.client.set(key, driver.settings.serialize(val));
		} else {
			return driver.client.set(
				key,
				driver.settings.serialize(val),
				'PX', // Prefix that next command is the timeout in MS
				Math.floor(expiry ? expiry - Date.now() : driver.settings.memcached.lifetime), // Timeout in MS
			);
		}
	};

	driver.get = (key, fallback) => {
		return driver.client.get(key)
			.then(val => val ? driver.settings.deserialize(val) : fallback);
	};

	driver.size = key => {
		return driver.client.STRLEN(key);
	};

	driver.unset = key => {
		return driver.client.del(key);
	};

	driver.list = ()=> {
		var glob = driver.utilRegExpToGlob(driver.settings.keyQuery());
		if (glob == '.') glob = '*'; // Convert single char (anything) matches to glob all

		return driver.client.keys(glob)
			.then(keys => keys.map(doc => ({
				id: doc,
			})));
	};

	driver.has = key => {
		return driver.client.keys(key)
			.then(keys => (keys && keys.length > 0));
	};

	driver.destroy = ()=> {
		return driver.client.quit();
	};

	/**
	* Utility function to convert a RegExp to a Redis glob query
	* @param {RegExp} re Regular expression to convert
	* @returns {string} A (basic) Redis glob
	*/
	driver.utilRegExpToGlob = re =>
		re
			.toString()
			.replace(/^\/(.*)\/$/, '$1') // Remove prefix / suffix braces
			.replace(/\?/g, '.')
			.replace(/\.\*/g, '*')
			.replace(/\.\+/g, '*');

	return driver;
};

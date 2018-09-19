var _ = require('lodash');
var redis = require('redis');

module.exports = function(settings) {
	var driver = this;

	driver.settings = _.defaults(settings, {
		redis: {
		},
	});

	driver.canLoad = function(cb) {
		driver.client = redis.createClient(driver.settings.redis)
			.on('error', err => {
				console.log('Redis error:', err);
				cb(null, false);
			})
			.on('ready', ()=> cb(null, true))
	};

	driver.set = function(key, val, expiry, cb) {
		if (!expiry) {
			driver.client.set(key, JSON.stringify(val), err => cb(err, val));
		} else {
			var expiryVal = expiry - Date.now();
			if (!expiryVal) { // Expires immediately - don't bother to store - unset instead
				driver.unset(key, ()=> cb(null, val));
			} else {
				driver.client.set(key, JSON.stringify(val), 'PX', expiryVal, err => cb(err, val));
			}
		}
	};

	driver.get = function(key, fallback, cb) {
		driver.client.get(key, (err, val) => {
			if (err) return cb(err);
			cb(null, val ? JSON.parse(val) : undefined);
		});
	};

	driver.unset = function(key, cb) {
		driver.client.del(key, cb);
	};

	driver.list = function(cb) {
		var glob = driver.utilRegExpToGlob(driver.settings.keyQuery());
		if (glob == '.') glob = '*'; // Convert single char (anything) matches to glob all

		driver.client.keys(glob, (err, list) => {
			if (err) return cb(err);

			cb(null, list.map(doc => ({
				id: doc,
			})));
		});
	};

	driver.destroy = function(cb) {
		driver.client.quit(cb);
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

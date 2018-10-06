var _ = require('lodash');

module.exports = function(settings) {
	var driver = this;
	driver.store = {};

	driver.canLoad = function(cb) {
		cb(null, true); // Memory module is always available
	};

	driver.set = function(key, val, expiry, cb) {
		driver.store[key] = {
			value: val,
			expiry: expiry,
			created: new Date(),
		};

		cb(null, val);
	};

	driver.get = function(key, fallback, cb) {
		var existing = driver.store[key];
		var now = new Date();
		if (existing && (!existing.expiry || existing.expiry > now)) { // Is valid and has not yet expired
			cb(null, existing.value);
		} else if (existing && existing.expiry && existing.expiry <= now) { // Has expired - release memory
			this.unset(key, ()=> {
				cb(null, fallback || undefined);
			});
		} else { // Not found anyway
			cb(null, fallback || undefined);
		}
	};

	driver.unset = function(key, cb) {
		delete driver.store[key];
		cb();
	};

	driver.has = function(key, cb) {
		cb(null, _.has(driver.store, key));
	};

	driver.list = function(cb) {
		cb(null, _.map(driver.store, (v, k) => ({
			id: k,
			expiry: v.expiry,
			created: v.created,
		})));
	};

	driver.vacuume = function(cb) {
		var now = new Date();
		driver.store = _.pickBy(driver.store, (s, k) => !s.expiry || s.expiry > now);
		cb();
	};

	driver.destroy = function(cb) {
		cb();
	};

	return driver;
};

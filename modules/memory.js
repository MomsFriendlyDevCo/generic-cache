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

	driver.vacuume = function(cb) {
		var now = new Date();
		driver.store = _.pickBy(driver.store, (s, k) => !s.expiry || s.expiry > now);
		cb();
	};

	return driver;
};

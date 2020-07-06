var _ = require('lodash');
var marshal = require('@momsfriendlydevco/marshal');

module.exports = function(settings) {
	var driver = {};
	driver.store = {};

	driver.canLoad = ()=> true; // Memory module is always available

	driver.set = (key, val, expiry) => {
		driver.store[key] = {
			value: val,
			expiry: expiry,
			created: new Date(),
		};

		return val;
	};

	driver.get = (key, fallback) => {
		var existing = driver.store[key];
		var now = new Date();
		if (existing && (!existing.expiry || existing.expiry > now)) { // Is valid and has not yet expired
			return existing.value;
		} else if (existing && existing.expiry && existing.expiry <= now) { // Has expired - release memory
			return Promise.resolve(driver.unset(key)).then(()=> fallback);
		} else { // Not found anyway
			return fallback;
		}
	};

	driver.size = key => {
		var existing = driver.store[key];
		if (!existing) return undefined;
		return marshal.serialize(existing.value).length;
	};

	driver.unset = key => delete driver.store[key];

	driver.has = key => _.has(driver.store, key);

	driver.list = ()=>
		_.map(driver.store, (v, k) => ({
			id: k,
			expiry: v.expiry,
			created: v.created,
		}));

	driver.clean = ()=> {
		var now = new Date();
		driver.store = _.pickBy(driver.store, (s, k) => !s.expiry || s.expiry > now);
	};

	driver.destroy = ()=> null;

	return driver;
};

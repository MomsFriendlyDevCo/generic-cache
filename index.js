var _ = require('lodash');
var argy = require('argy');
var async = require('async-chainable');
var events = require('events');
var util = require('util');

/**
* Constructor for a cache object
* @param {Object} settings Settings to use when loading the cache
* @param {function} cb Callback when the module has loaded
*/
function Cache(settings, cb) {
	var cache = this;
	cache.modules = ['memory']; // Shorthand method that drivers should load - these should exist in modules/

	cache.modulePath = `${__dirname}/modules`
	cache.activeModule;
	cache.activeDriver; // Computed during init()

	cache.settings = _.defaults(settings, {
		modules: ['memory'],
	});

	cache.init = argy('[object] [function]', function(options, cb) {
		_.merge(cache.settings, options);

		async()
			.limit(1)
			.forEach(_.castArray(cache.settings.modules), function(next, driverName) {
				if (cache.activeModule) return next(); // Already loaded something
				try {
					var mod = require(`${cache.modulePath}/${driverName}`)(settings);
				} catch (e) {
					next(e);
				}

				mod.canLoad((err, res) => {
					if (err) return next(err);
					if (res) {
						cache.activeModule = mod;
					}
					next();
				});
			})
			.then(function(next) {
				if (!cache.activeModule) return next('No module available to load from list: ' + cache.modules.join(', '));
				next();
			})
			.end(cb);

		return cache;
	});


	/**
	* Calls the active modules set() function
	* @param {*} key The key to set, this can be any valid object storage key. If this is an object all keys will be set in parallel
	* @param {*} [val] The value to set, this can be any marshallable valid JS object, can be omitted if key is an object
	* @param {date} [expiry] The expiry of the value, after this date the storage will reset to undefined
	* @param {function} [cb] The callback to fire when the value was stored. Called as (err, val)
	* @returns {Object} This chainable cache module
	*/
	cache.set = argy('[object|scalar] [scalar] [date] [function]', function(key, val, expiry, cb) {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		if (argy.isType(key, 'object')) {
			async()
				.forEach(key, function(next, val, key) {
					cache.activeModule.set(key, val, expiry, next);
				})
				.end(function(err) {
					if (err) return cb(err);
					cb(null, key);
				})
		} else {
			cache.activeModule.set(key, val, expiry, cb || _.noop);
		}

		return cache;
	});


	/**
	* Calls the active modules get() function
	* @param {*} key The key to retrieve, this can be any valid object storage key
	* @param {*} [fallback=undefined] The falllback value to return if the storage has expired or is not set
	* @param {function} cb The callback to fire with the retrieved value
	* @returns {Object} This chainable cache module
	*/
	cache.get = argy('scalar [scalar] function', function(key, fallback, cb) {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		cache.activeModule.get(key, fallback, cb || _.noop);

		return cache;
	});


	/**
	* Release a set key, any subsequent get() call for this key will fail
	* @param {*} key The key to release, this can be any valid object storage key
	* @param {function} cb The callback to fire when completed
	* @returns {Object} This chainable cache module
	*/
	cache.unset = argy('scalar [function]', function(key, cb) {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		cache.activeModule.unset(key, cb || _.noop);

		return cache;
	});


	/**
	* Attempt to clean up any remaining items
	* Only some drivers may implement this function
	* @param {function} cb The callback to fire when completed
	* @returns {Object} This chainable cache module
	*/
	cache.vacuume = argy('[function]', function(cb) {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		cache.activeModule.vacuume(cb || _.noop);

		return cache;
	});

	cache.init(settings, cb || _.noop);

	return cache;
}

util.inherits(Cache, events.EventEmitter);

module.exports = Cache;

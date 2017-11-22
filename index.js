var _ = require('lodash');
var argy = require('argy');
var async = require('async-chainable');
var crypto = require('crypto');
var events = require('events');
var util = require('util');

/**
* Constructor for a cache object
* @param {Object} options Settings to use when loading the cache
* @param {function} cb Callback when the module has loaded
* @returns {Cache} A cache object constructor
*/
function Cache(options, cb) {
	var cache = this;
	cache.modules = ['memory']; // Shorthand method that drivers should load - these should exist in modules/

	cache.modulePath = `${__dirname}/modules`
	cache.activeModule;
	cache.activeDriver; // Computed during init()

	cache.settings = {
		init: true, // automatically run cache.init() when constructing
		modules: ['memory'],
	};


	/**
	* Merge the specified setting or object of settings into cache.settings
	* @param {string|array|Object} key Either the single (dotted notation allowed) path to set, an array of path segments or the entire object to be merged
	* @param {*} [val] If key is a single string this is the value to set
	* @returns {Cache} This chainable object
	*/
	cache.options = argy('string|array|Object [*]', function(key, val) {
		if (argy.isType(key, 'object')) {
			_.merge(cache.settings, key);
		} else {
			_.set(cache.settings, key, val);
		}
		return cache;
	});


	/**
	* Alias for options()
	* @alias options()
	*/
	cache.option = cache.options;


	/**
	* Boot the cache object (automaticaly called if cache.settings.init
	* @param {Object} [options] Options to load when booting - this is merged with cache.settings before boot
	* @param {function} cb Callback function to call when finsihed. Called as (err)
	* @returns {Cache} This chainable object
	* @emits noMods Emitted when no modules are available to load and we cannot continue - an error is also raised via the callback
	* @emits cantLoad Emitted as (mod) when a named module cannot be loaded
	*/
	cache.init = argy('[function]', function(cb) {
		async()
			.limit(1)
			// Try all selected modules in sequence until one says it can load {{{
			.forEach(_.castArray(cache.settings.modules), function(next, driverName) {
				if (cache.activeModule) return next(); // Already loaded something
				try {
					var mod = require(`${cache.modulePath}/${driverName}`)(cache.settings);

					mod.canLoad((err, res) => {
						if (err) {
							cache.emit('cantLoad', driverName);
							next(); // Disguard error and try next
						} else if (res) { // Response is truthy - accept module load
							cache.activeModule = mod;
							next();
						} else { // No response - try next
							cache.emit('cantLoad', driverName);
							next();
						}
					});
				} catch (e) {
					next(e);
				}
			})
			// }}}
			// Set the active mod or deal with errors {{{
			.then(function(next) {
				if (!cache.activeModule) {
					cache.emit('noMods');
					return next('No module available to load from list: ' + cache.modules.join(', '));
				} else {
					next();
				}
			})
			// }}}
			// End {{{
			.end(cb)
			// }}}

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
	cache.set = argy('object|scalar [object|scalar] [date] [function]', function(key, val, expiry, cb) {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		if (argy.isType(key, 'object')) {
			async()
				.forEach(key, function(next, val, key) {
					cache.activeModule.set(key, val, expiry, next);
				})
				.end(function(err) {
					if (argy.isType(cb, 'function')) {
						if (err) return cb(err);
						cb(null, key);
					}
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


	/**
	* Utility function to hash complex objects
	* @param {*} val Value to hash. If this is a complex object it will be run via JSON.stringify
	* @returns {string} The SHA256 hash of the input
	*/
	cache.hash = function(val) {
		return crypto.createHash('sha256')
			.update(argy.isType(val, 'scalar') ? val : JSON.stringify(val))
			.digest('hex')
	};

	cache.options(options);

	// Init automatically if cache.settings.init
	if (cache.settings.init) {
		cache.init(cb);
	} else if (argy.isType(cb, 'function')) {
		cb();
	}

	return cache;
}

util.inherits(Cache, events.EventEmitter);

module.exports = Cache;

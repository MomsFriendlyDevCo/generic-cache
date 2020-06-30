var _ = require('lodash');
var argy = require('argy');
var async = require('async-chainable');
var crypto = require('crypto');
var debug = require('debug')('cache');
var events = require('events');
var marshal = require('@momsfriendlydevco/marshal');
var timestring = require('timestring');
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

	cache.flushing = 0; // Number of set operations still writing (used by destroy to determine when to actually die)

	/**
	* The currently active module we are using to actually cache things
	* This is computed via init()
	* Its spec should resemble a standard driver export (e.g. use `id` key to determine unique ID)
	* @var {Object}
	*/
	cache.activeModule;

	cache.settings = {
		init: true, // automatically run cache.init() when constructing
		keyMangle: key => key,
		keyQuery: q => /./,
		modules: ['memory'],
		serialize: v => marshal.serialize(v, {circular: false}),
		deserialize: v => marshal.deserialize(v, {circular: false}),
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
	* @param {function} [cb] Optional callback function to call when finsihed. Called as (err)
	* @returns {Promise} A promise which will resolve when the startup process completes
	* @emits loadedMod Emitted when a module has been successfully loaded
	* @emits noMods Emitted when no modules are available to load and we cannot continue - an error is also raised via the callback
	* @emits cantLoad Emitted as (mod) when a named module cannot be loaded
	*/
	cache.init = argy('[function]', cb =>
		async()
			.limit(1)
			// Try all selected modules in sequence until one says it can load {{{
			.forEach(_.castArray(cache.settings.modules), function(next, driverName) {
				if (cache.activeModule) return next(); // Already loaded something
				try {
					var mod = require(`${cache.modulePath}/${driverName}`).call(this, cache.settings, cache);

					mod.canLoad((err, res) => {
						if (err) {
							cache.emit('cantLoad', driverName);
							next(); // Disguard error and try next
						} else if (res) { // Response is truthy - accept module load
							cache.emit('loadedMod', driverName);
							cache.activeModule = mod;
							cache.activeModule.id = driverName;
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
					debug('No module to load!');
					return next('No module available to load from list: ' + cache.modules.join(', '));
				} else {
					debug('Using module', cache.activeModule.id);
					next();
				}
			})
			// }}}
			// End {{{
			.promise(cb)
			// }}}
	);


	/**
	* Calls the active modules set() function
	* @param {*} key The key to set, this can be any valid object storage key. If this is an object all keys will be set in parallel
	* @param {*} [val] The value to set, this can be any marshallable valid JS object, can be omitted if key is an object
	* @param {date|number|string} [expiry] The expiry of the value, after this date the storage will reset to undefined. Any value passed is run via cache.convertDateRelative() first
	* @param {function} [cb] The callback to fire when the value was stored. Called as (err, valueSet)
	* @returns {Promise} A promise representing the set action. Resolved as `(valueSet)`
	*/
	cache.set = argy('object|scalar [object|array|scalar] [date|number|string] [function]', function(key, val, expiry, cb) {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		if (argy.isType(key, 'object')) {
			return async()
				.forEach(key, function(next, val, key) {
					debug('> Set', key);
					cache.flushing++;
					var expiryDate = cache.convertDateRelative(expiry);
					debug('Set Object' + (expiry ? ` (Expiry ${expiryDate})` : '') + ':');
					cache.activeModule.set(cache.settings.keyMangle(key), val, expiryDate, err => {
						cache.flushing--;
						next(err);
					});
				})
				.promise('key', cb)
		} else {
			cache.flushing++;
			var expiryDate = cache.convertDateRelative(expiry);
			debug('Set ' + key  + (expiry ? ` (Expiry ${expiryDate})` : ''));
			return async()
				.then(next => cache.activeModule.set(cache.settings.keyMangle(key), val, expiryDate, next))
				.then(()=> cache.flushing--)
				.promise(cb);
		}
	});


	/**
	* Calls the active modules get() function
	* @param {*|array} key The key to retrieve, this can be any valid object storage key, If this is an array an object is returned with a key/value combination
	* @param {*} [fallback=undefined] The falllback value to return if the storage has expired or is not set
	* @param {function} [cb] The callback to fire with the retrieved value
	* @returns {Promise} Promise representing the retrieved value
	*/
	cache.get = argy('scalar|array [object|array|scalar] [function]', function(key, fallback, cb) {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		if (_.isArray(key)) {
			return async()
				.set('result', {})
				.forEach(key, function(next, key) {
					cache.activeModule.get(cache.settings.keyMangle(key), fallback, (err, res) => {
						if (err) return next(err);
						if (res) this.result[key] = res;
						next();
					});
				})
				.promise('result', cb);
		} else {
			debug('Get', key);
			return async()
				.then('value', next => cache.activeModule.get(cache.settings.keyMangle(key), fallback, next))
				.promise('value', cb);
		}
	});


	/**
	* Calls the active modules has() function
	* @param {*} key The key to check, this can be any valid object storage key
	* @param {function} [cb] The callback to fire with a boolean indicating that the value exists
	* @returns {Promise} A promise representing whether the key exists
	*/
	cache.has = argy('scalar [function]', function(key, cb) {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		debug('Has', key);
		if (_.isFunction(cache.activeModule.has)) {
			return async()
				.then('hasValue', next => cache.activeModule.has(cache.settings.keyMangle(key), next))
				.promise('hasValue', cb);
		} else { // Doesn't implement 'has' use get as a quick fix
			return async()
				.then('value', next => cache.get(key, '!!!NONEXISTANT!!!', next))
				.then('hasValue', function(next) { next(null, this.value !== '!!!NONEXISTANT!!!') })
				.promise('hasValue', cb);
		}
	});


	/**
	* Calls the active modules size() function
	* @param {*} key The key to check, this can be any valid object storage key
	* @param {function} [cb] The callback to fire with a boolean indicating that the value exists
	* @returns {Promise} A promise representing whether the size in bytes or undefined
	*/
	cache.size = argy('scalar [function]', function(key, cb) {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		debug('Size', key);
		if (!_.isFunction(cache.activeModule.size)) return Promise.reject('Size is not supported by the selected cache module');

		return async()
			.then('sizeValue', next => cache.activeModule.size(cache.settings.keyMangle(key), next))
			.promise('sizeValue', cb);
	});


	/**
	* Release a set key, any subsequent get() call for this key will fail
	* @param {*|array} key The key or array of keys to release, this can be any valid object storage key
	* @param {function} [cb] The callback to fire when completed
	* @returns {Promise}
	*/
	cache.unset = argy('scalar|array [function]', function(keys, cb) {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		return async()
			.forEach(_.castArray(keys), function(next, key) {
				debug('Unset', key);
				cache.activeModule.unset(cache.settings.keyMangle(key), next);
			})
			.promise(cb);
	});


	/**
	* Return a list of current cache values
	* Only some drivers may implement this function
	* Each return item is expected to have at least 'id' with optional keys 'expiry', 'created'
	* @param {function} [cb] The callback to fire when completed. Called as (err, items)
	* @returns {Promise} A promise representing the cached items
	*/
	cache.list = argy('[function]', function(cb) {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		debug('List');
		return async()
			.then('items', next => cache.activeModule.list(next))
			.promise('items', cb);
	});


	/**
	* Attempt to clean up any remaining items
	* Only some drivers may implement this function
	* NOTE: If the driver does not implement BUT the driver has a list function that returns expiry data a simple loop + expiry check + unset worker will be implemented instead
	* @param {function} [cb] The callback to fire when completed
	* @returns {Promise}
	*/
	cache.vacuume = argy('[function]', function(cb) {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		debug('Vacuume');

		if (cache.activeModule.vacuume) { // Driver implments its own function
			return async()
				.then(next => cache.activeModule.vacuume(next))
				.promise(cb);
		} else if (cache.activeModule.list && cache.activeModule.unset) { // Driver implements a list which we can use instead
			var now = new Date();
			return async()
				.then('items', next => cache.activeModule.list(next))
				.forEach('items', (next, item) => {
					if (item.id && item.expiry && item.expiry < now) {
						cache.activeModule.unset(item.id, next);
					} else {
						next();
					}
				})
				.promise(cb);
		} else {
			return Promise.reject('Vacuume is not supported by the selected cache module');
		}
	});


	/**
	* Attempt to erase ALL cache contents
	* Only some drivers may implement this function
	* NOTE: If the driver does not implement BUT the driver has a list function that returns expiry data a simple loop + expiry check + unset worker will be implemented instead
	* @param {function} [cb] The callback to fire when completed
	* @returns {Promise} This chainable cache module
	*/
	cache.clear = argy('[function]', function(cb) {
		if (!cache.activeModule) Promise.reject('No cache module loaded. Use cache.init() first');
		debug('Clear');

		if (cache.activeModule.clear) { // Driver implments its own function
			return async()
				.then(next => cache.activeModule.clear(next))
				.promise(cb);
		} else if (cache.activeModule.list && cache.activeModule.unset) { // Drive implements a list which we can use instead
			return async()
				.then('items', next => cache.activeModule.list(next))
				.forEach('items', (next, item) => cache.activeModule.unset(item.id, next))
				.promise(cb);
		} else {
			return Promise.reject('Clear is not supported by the selected cache module');
		}
	});


	/**
	* Returns whether the loaded module supports a given function
	* @param {string} func The function to query
	* @returns {boolean} Whether the active module supports the action
	*
	* @example Can a module clear?
	* cache.can('clear') //= Value depends on module
	*/
	cache.can = argy('string', function(func) {
		switch (func) {
			case 'clear':
			case 'vacuume':
				return _.isFunction(cache.activeModule[func])
				|| (_.isFunction(cache.activeModule.list) && _.isFunction(cache.activeModule.unset))
			default: // Also includes 'list'
				return !! _.isFunction(cache.activeModule[func]);
		}
	});


	/**
	* Politely close all driver resource handles
	* NOTE: The destroy function will wait until all set() operations complete before calling the callback
	* @param {function} [cb] The callback to fire when completed
	* @returns {Promise}
	*/
	cache.destroy = argy('[function]', function(cb) {
		debug('Destroy');

		return async()
			.then(function(next) {
				(cache.activeModule && cache.activeModule.destroy ? cache.activeModule.destroy : _.noop)(()=> {
					debug('Destroy - modules terminated');

					var dieAttempt = 0;
					var dieWait = 100;
					var tryDying = ()=> {
						if (cache.flushing > 0) {
							debug(`Destory - still flushing. Attempt ${dieAttempt++}, will try again in ${dieWait}ms`);
							dieWait *= 2; // Increase wait backoff
							setTimeout(tryDying, dieWait);
						} else {
							if (cb) cb();
							next();
						}
					};

					tryDying();
				});
			})
			.promise(cb);
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


	/**
	* Convert an input value into a Date object
	* This function can take dates, millisecond offsets, timestring() strings or moment objects
	* @param {number|string|Date|Moment} val The input value to convert
	* @returns {Date} A Date object
	*/
	cache.convertDateRelative = val =>
		!val ? undefined // Invalid object?
			: _.isDate(val) ? val // Already a date?
			: val.constructor.name == 'Moment' ? val.toDate() // Is a Moment object?
			: isFinite(val) ? new Date(Date.now() + Number(val)) // Looks like a number?
			: typeof val == 'string' ? new Date(Date.now() + timestring(val, 'ms')) // Relative time string
			: undefined;


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

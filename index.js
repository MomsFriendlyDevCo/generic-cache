var _ = require('lodash');
var crypto = require('crypto');
var debug = require('debug')('cache');
var events = require('events');
var marshal = require('@momsfriendlydevco/marshal');
var timestring = require('timestring');
var util = require('util');

/**
* Constructor for a cache object
* @param {Object} options Settings to use when loading the cache
* @returns {Cache} A cache object constructor
*/
function Cache(options) {
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
		cleanInit: false,
		cleanAuto: false,
		cleanAutoInterval: '1h',
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
	cache.options = (key, val) => {
		if (_.isPlainObject(key)) {
			_.merge(cache.settings, key);
		} else {
			_.set(cache.settings, key, val);
		}
		return cache;
	};


	/**
	* Setup / cancel auto cleaning
	* @param {string|boolean} newInterval Either the new auto-cleaning interval or falsy to disable
	* @returns {Cache} This chainable object
	*
	* @emits autoCleanSet emitted as (newInterval) when an autoClean value is provied
	* @emits autoClean emitted when an autoClean is starting
	* @emits autoCleanEnd emitted when an autoClean has completed
	*/
	cache.autoClean = function(newInterval) {
		debug('autoClean', newInterval);
		this.emit('autoCleanSet', newInterval);

		// Remove existing timer if there is one
		if (cache.autoClean.timerHandle) clearInterval(cache.autoClean.timerHandle);

		if (newInterval) // If truthy subscribe to the cleaning timer
			cache.autoClean.timerHandle = setTimeout(()=> {
				cache.clean()
					.then(()=> debug('autoClean', 'start'))
					.then(()=> this.emit('autoClean'))
					.then(()=> cache.autoClean())
					.finally(()=> debug('autoClean', 'end'))
					.finally(()=> this.emit('autoCleanEnd'))
			}, cache.settings.autoCleanInterval);

		return cache;
	};


	/**
	* Alias for options()
	* @alias options()
	*/
	cache.option = cache.options;


	/**
	* Boot the cache object (automaticaly called if cache.settings.init
	* @param {Object} [options] Options to load when booting - this is merged with cache.settings before boot
	* @returns {Promise} A promise which will resolve when the startup process completes
	* @emits loadedMod Emitted when a module has been successfully loaded
	* @emits noMods Emitted when no modules are available to load and we cannot continue - an error is also raised via the callback
	* @emits cantLoad Emitted as (mod) when a named module cannot be loaded
	*/
	cache.init = ()=> {
		if (cache.init.promise) return cache.init.promise; // Execute only once and return a promise

		return cache.init.promise = Promise.resolve() // Setup dummy promise...
			.then(()=> cache.promiseSeries(
				_.castArray(cache.settings.modules)
					.map(moduleName => ()=> Promise.resolve()
						.then(()=> require(`${cache.modulePath}/${moduleName}`))
						.then(mod => mod.call(this, cache.settings, cache))
						.then(mod => Promise.resolve(mod.canLoad()).then(canLoad => [mod, canLoad]))
						.then(data => {
							var [mod, canLoad] = data;

							if (canLoad) {
								cache.emit('loadedMod', moduleName);
								cache.activeModule = mod;
								cache.activeModule.id = moduleName;
							} else {
								cache.emit('cantLoad', moduleName);
							}
						})
					)
			))
			.then(()=> {
				if (!cache.activeModule) {
					cache.emit('noMods');
					debug('No module to load!');
					throw new Error('No module available to load from list: ' + cache.settings.modules.join(', '));
				} else {
					debug('Using module', cache.activeModule.id);
				}
			})
			.then(()=> cache.settings.cleanInit && cache.clean())
			.then(()=> cache.settings.cleanAuto && cache.autoClean())
			.then(()=> cache)
	};


	/**
	* Calls the active modules set() function
	* @param {*} key The key to set, this can be any valid object storage key. If this is an object all keys will be set in parallel
	* @param {*} [val] The value to set, this can be any marshallable valid JS object, can be omitted if key is an object
	* @param {date|number|string} [expiry] The expiry of the value, after this date the storage will reset to undefined. Any value passed is run via cache.convertDateRelative() first
	* @returns {Promise<*>} A promise representing the set action. Resolved with the given value
	*/
	cache.set = (key, val, expiry) => {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');
		var expiryDate = cache.convertDateRelative(expiry);
		if (expiryDate < new Date()) throw new Error('Cache entry expiry date cannot be in the past');

		if (_.isPlainObject(key)) {
			return Promise.all(Object.keys(key).map(k => {
				debug('> Set', k);
				cache.flushing++;
				debug('Set Object' + (expiry ? ` (Expiry ${expiryDate})` : '') + ':');
				return Promise.resolve(cache.activeModule.set(cache.settings.keyMangle(k), key[k], expiryDate))
					.then(()=> cache.flushing--)
			})).then(()=> val);
		} else {
			cache.flushing++;
			debug('Set ' + key  + (expiry ? ` (Expiry ${expiryDate})` : ''));
			return Promise.resolve(cache.activeModule.set(cache.settings.keyMangle(key), val, expiryDate))
				.then(()=> cache.flushing--)
				.then(()=> val)
		}
	};


	/**
	* Calls the active modules get() function
	* @param {*|array} key The key to retrieve, this can be any valid object storage key, If this is an array an object is returned with a key/value combination
	* @param {*} [fallback=undefined] The falllback value to return if the storage has expired or is not set
	* @returns {Promise<*>} Promise representing the retrieved value or the fallback if none is present
	*/
	cache.get = (key, fallback) => {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		if (_.isArray(key)) {
			var result = {};
			return Promise.all(key.map(k =>
				Promise.resolve(cache.activeModule.get(cache.settings.keyMangle(k), fallback))
					.then(v => result[k] = v)
			)).then(()=> result);
		} else {
			debug('Get', key);
			return Promise.resolve(cache.activeModule.get(cache.settings.keyMangle(key), fallback));
		}
	};


	/**
	* Calls the active modules has() function
	* @param {*} key The key to check, this can be any valid object storage key
	* @returns {Promise<boolean>} A promise representing whether the key exists
	*/
	cache.has = key => {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		debug('Has', key);
		if (cache.can('has')) {
			return Promise.resolve(cache.activeModule.has(cache.settings.keyMangle(key)));
		} else { // Doesn't implement 'has' use get as a quick fix
			return cache.get(key, '!!!NONEXISTANT!!!')
				.then(value => value !== '!!!NONEXISTANT!!!')
		}
	};


	/**
	* Calls the active modules size() function
	* @param {*} key The key to check, this can be any valid object storage key
	* @returns {Promise<number|undefined>} A promise representing whether the size in bytes or undefined
	*/
	cache.size = key => {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		debug('Size', key);
		if (!_.isFunction(cache.activeModule.size)) throw new Error('Size is not supported by the selected cache module');

		return Promise.resolve(cache.activeModule.size(cache.settings.keyMangle(key)));
	};


	/**
	* Release a set key, any subsequent get() call for this key will fail
	* @param {*|array} key The key or array of keys to release, this can be any valid object storage key
	* @returns {Promise} A promise which will resolve when the value has been unset
	*/
	cache.unset = keys => {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		return Promise.all(
			_.castArray(keys)
				.map(key => {
					debug('Unset', key);
					return cache.activeModule.unset(cache.settings.keyMangle(key))
				})
		);
	};


	/**
	* Return a list of current cache values
	* Only some drivers may implement this function
	* Each return item is expected to have at least 'id' with optional keys 'expiry', 'created'
	* @returns {Promise<Array>} A promise representing the cached items each item is of the form `{id, size?, expiry?}`
	*/
	cache.list = ()=> {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		debug('List');
		return Promise.resolve(cache.activeModule.list());
	};


	/**
	* Attempt to clean up any remaining items
	* Only some drivers may implement this function
	* NOTE: If the driver does not implement BUT the driver has a list function that returns expiry data a simple loop + expiry check + unset worker will be implemented instead
	* @returns {Promise} A promise which will resolve when cleanup is complete
	*/
	cache.clean = ()=> {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		debug('Clean');

		if (_.isFunction(cache.activeModule.clean)) { // Driver implments its own function
			return Promise.resolve(cache.activeModule.clean());
		} else if (cache.can('list')) { // Driver implements a list which we can use instead
			var now = new Date();
			return cache.activeModule.list()
				.then(items => Promise.all(items.map(item =>
					item.id && item.expiry && item.expiry < now
						? cache.activeModule.unset(item.id)
						: null
				)))
		} else {
			throw new Error('Clean is not supported by the selected cache module');
		}
	};


	/**
	* Attempt to erase ALL cache contents
	* Only some drivers may implement this function
	* NOTE: If the driver does not implement BUT the driver has a list function that returns expiry data a simple loop + expiry check + unset worker will be implemented instead
	* @returns {Promise} A promise which will resolve when the cache has been cleared
	*/
	cache.clear = ()=> {
		if (!cache.activeModule) throw new Error('No cache module loaded. Use cache.init() first');
		debug('Clear');

		if (cache.activeModule.clear) { // Driver implments its own function
			return Promise.resolve(cache.activeModule.clear());
		} else if (cache.activeModule.list && cache.activeModule.unset) { // Driver implements a list interface which we can use instead
			return Promise.resolve()
				.then(()=> cache.activeModule.list())
				.then(items => Promise.all(items.map(item =>
					cache.activeModule.unset(item.id)
				)))
		} else {
			throw new Error('Clear is not supported by the selected cache module');
		}
	};


	/**
	* Returns whether the loaded module supports a given function
	* @param {string} func The function to query
	* @returns {boolean} Whether the active module supports the action
	*
	* @example Can a module clear?
	* cache.can('clear') //= Value depends on module
	*/
	cache.can = func => {
		switch (func) {
			case 'clear':
			case 'clean':
				return _.isFunction(cache.activeModule[func])
				|| (_.isFunction(cache.activeModule.list) && _.isFunction(cache.activeModule.unset))
			default: // Also includes 'list'
				return !! _.isFunction(cache.activeModule[func]);
		}
	};


	/**
	* Politely close all driver resource handles
	* NOTE: The destroy function will wait until all set() operations complete before calling the callback
	* @returns {Promise} A promise which will resolve when all drivers have been released
	*/
	cache.destroy =()=> {
		debug('Destroy');
		return Promise.resolve(
			cache.can('destroy')
			? cache.activeModule.destroy()
			: null
		)
			.then(()=> new Promise((resolve, reject) => {
				debug('Destroy - modules terminated');

				var dieAttempt = 0;
				var dieWait = 100;
				var tryDying = ()=> {
					if (cache.flushing > 0) {
						debug(`Destory - still flushing. Attempt ${dieAttempt++}, will try again in ${dieWait}ms`);
						dieWait *= 2; // Increase wait backoff
						setTimeout(tryDying, dieWait);
					} else {
						resolve();
					}
				};

				tryDying();
			}))
	};


	/**
	* Utility function to hash complex objects
	* @param {*} val Value to hash. If this is a complex object it will be run via JSON.stringify
	* @returns {string} The SHA256 hash of the input
	*/
	cache.hash = val =>
		crypto.createHash('sha256')
			.update(!_.isObject(val) ? val : JSON.stringify(val))
			.digest('hex');


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


	/**
	* Resolve promises in series
	* This works the same as Promise.all() but resolves its payload, one at a time until all promises are resolved
	* NOTE: Because of the immediately-executing 'feature' of Promises it is recommended that the input array provide
	*       an array of functions which return Promises rather than promises directly - i.e. return promise factories
	*
	* @param {array <Function>} promises An array of promise FACTORIES which will be evaluated in series
	* @returns {Promise} A promise which will resolve/reject based on the completion of the given promise factories being resolved
	* @url https://github.com/MomsFriendlyDevCo/Nodash
	*
	* @example Evaluate a series of promises with a delay, one at a time, in order (note that the map returns a promise factory, otherwise the promise would execute immediately)
	* cache.promiseSeries(
	*   [500, 400, 300, 200, 100, 0, 100, 200, 300, 400, 500].map((delay, index) => ()=> new Promise(resolve => {
	*     setTimeout(()=> { console.log('EVAL', index, delay); resolve(); }, delay);
	*   }))
	* )
	*/
	cache.promiseSeries = promises =>
		promises.reduce((chain, promise) =>
			chain.then(()=>
				Promise.resolve(
					typeof promise == 'function' ? promise() : promise
				)
			)
			, Promise.resolve()
		);


	cache.options(options);

	// Init automatically if cache.settings.init
	if (cache.settings.init) cache.init();

	return cache;
}

util.inherits(Cache, events.EventEmitter);

module.exports = Cache;

import _ from 'lodash';
import crypto from 'node:crypto';
import {dirName} from '@momsfriendlydevco/es6';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import fsPath from 'node:path';
import marshal from '@momsfriendlydevco/marshal';
import timestring from 'timestring';

const __dirname = dirName();

export default class CacheBase extends EventEmitter {

	/**
	* List of modules to load - these should exist in `./modules/` or `cache.availableModules`
	* @type {Array<String>}
	*/
	modules = ['memory'];


	/**
	* Where to load modules from
	* @type {String}
	*/
	modulePath = fsPath.resolve(`${__dirname}/../modules`);


	/**
	* Number of set operations still writing (used by destroy to determine when to actually die)
	* @type {Number}
	*/
	flushing = 0;


	/**
	* The currently active module we are using to actually cache things
	* This is computed via init()
	* Its spec should resemble a standard driver export (e.g. use `id` key to determine unique ID)
	* @type {Object}
	*/
	activeModule;


	/**
	* Cache init settings
	* @type {Object}
	*/
	settings = {
		init: true, // automatically run cache.init() when constructing
		cleanInit: false,
		cleanAuto: false,
		cleanAutoInterval: '1h',
		keyMangle: key => key,
		keyQuery: q => /./, // eslint-disable-line no-unused-vars
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
	options(key, val) {
		if (_.isPlainObject(key)) {
			Object.entries(key)
				.forEach(([key, val]) => this.options(key, val))
		} else {
			if (key == 'module') key = 'module'; // Rewrite module plurals
			_.set(this.settings, key, val);
		}
		return this;
	}


	/**
	* Alias for options()
	* @alias options()
	*/
	option = this.options;


	/**
	* Setup / cancel auto cleaning
	* @param {string|boolean} newInterval Either the new auto-cleaning interval or falsy to disable
	* @returns {Cache} This chainable object
	*
	* @emits autoCleanSet emitted as (newInterval) when an autoClean value is provied
	* @emits autoClean emitted when an autoClean is starting
	* @emits autoCleanEnd emitted when an autoClean has completed
	*/
	autoClean(newInterval) {
		this.debug('autoClean', newInterval);
		this.emit('autoCleanSet', newInterval);

		// Remove existing timer if there is one
		if (this.autoClean.timerHandle) clearInterval(this.autoClean.timerHandle);

		if (newInterval) // If truthy subscribe to the cleaning timer
			this.autoClean.timerHandle = setTimeout(()=> {
				this.clean()
					.then(()=> this.debug('autoClean', 'start'))
					.then(()=> this.emit('autoClean'))
					.then(()=> this.autoClean())
					.finally(()=> this.debug('autoClean', 'end'))
					.finally(()=> this.emit('autoCleanEnd'))
			}, this.settings.autoCleanInterval);

		return this;
	}


	/**
	* Boot the cache object (automaticaly called if cache.settings.init
	* @param {Object} [options] Options to load when booting - this is merged with cache.settings before boot
	* @returns {Promise} A promise which will resolve when the startup process completes
	* @emits loadedMod Emitted when a module has been successfully loaded
	* @emits noMods Emitted when no modules are available to load and we cannot continue - an error is also raised via the callback
	* @emits cantLoad Emitted as (mod) when a named module cannot be loaded
	*/
	init() {
		if (this.initPromise) return this.initPromise; // Execute only once and return a promise

		return this.initPromise = Promise.resolve() // Setup dummy promise...
			.then(()=> this.promiseSeries(
				_.castArray(this.settings.modules)
					.map(moduleName => ()=> Promise.resolve()
						.then(()=> import(`${this.modulePath}/${moduleName}.js`))
						.then(mod => mod.default.call(this, this.settings, this))
						.then(mod => Promise.resolve(mod.canLoad()).then(canLoad => [mod, canLoad]))
						.then(data => {
							let [mod, canLoad] = data;

							if (canLoad) {
								this.debug('init', moduleName);
								this.emit('loadedMod', moduleName);
								this.activeModule = mod;
								this.activeModule.id = moduleName;
							} else {
								this.emit('cantLoad', moduleName);
							}
						})
					)
			))
			.then(()=> {
				if (!this.activeModule) {
					this.emit('noMods');
					this.debug('No module to load!');
					throw new Error('No module available to load from list: ' + this.settings.modules.join(', '));
				} else {
					this.debug('Using module', this.activeModule.id);
				}
			})
			.then(()=> this.settings.cleanInit && this.clean())
			.then(()=> this.settings.cleanAuto && this.autoClean())
			.then(()=> this)
	}


	/**
	* Pending init() promise if that is under-way
	* @type {Promise}
	*/
	initPromise;


	/**
	* Calls the active modules set() function
	* @param {*} key The key to set, this can be any valid object storage key. If this is an object all keys will be set in parallel
	* @param {*} [val] The value to set, this can be any marshallable valid JS object, can be omitted if key is an object
	* @param {date|number|string} [expiry] The expiry of the value, after this date the storage will reset to undefined. Any value passed is run via cache.convertDateRelative() first
	* @returns {Promise<*>} A promise representing the set action. Resolved with the given value
	*/
	set(key, val, expiry) {
		if (!this.activeModule) throw new Error('No cache module loaded. Use cache.init() first');
		let expiryDate = this.convertDateRelative(expiry);
		if (expiryDate < new Date()) throw new Error('Cache entry expiry date cannot be in the past');

		if (_.isPlainObject(key)) {
			return Promise.all(Object.keys(key).map(k => {
				this.debug('> Set', k);
				this.flushing++;
				this.debug('Set Object' + (expiry ? ` (Expiry ${expiryDate})` : '') + ':');
				return Promise.resolve(this.activeModule.set(this.settings.keyMangle(k), key[k], expiryDate))
					.then(()=> this.flushing--)
			})).then(()=> val);
		} else {
			this.flushing++;
			this.debug('Set ' + key  + (expiry ? ` (Expiry ${expiryDate})` : ''));
			return Promise.resolve(this.activeModule.set(this.settings.keyMangle(key), val, expiryDate))
				.then(()=> this.flushing--)
				.then(()=> val)
		}
	}


	/**
	* Calls the active modules get() function
	* @param {*|array} key The key to retrieve, this can be any valid object storage key, If this is an array an object is returned with a key/value combination
	* @param {*} [fallback=undefined] The falllback value to return if the storage has expired or is not set
	* @returns {Promise<*>} Promise representing the retrieved value or the fallback if none is present
	*/
	get(key, fallback) {
		if (!this.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		if (_.isArray(key)) {
			let result = {};
			return Promise.all(key.map(k =>
				Promise.resolve(this.activeModule.get(this.settings.keyMangle(k), fallback))
					.then(v => result[k] = v)
			)).then(()=> result);
		} else {
			this.debug('Get', key);
			return Promise.resolve(this.activeModule.get(this.settings.keyMangle(key), fallback));
		}
	}


	/**
	* Calls the active modules has() function
	* @param {*} key The key to check, this can be any valid object storage key
	* @returns {Promise<boolean>} A promise representing whether the key exists
	*/
	has(key) {
		if (!this.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		this.debug('Has', key);
		if (this.can('has')) {
			return Promise.resolve(this.activeModule.has(this.settings.keyMangle(key)));
		} else { // Doesn't implement 'has' use get as a quick fix
			return this.get(key, '!!!NONEXISTANT!!!')
				.then(value => value !== '!!!NONEXISTANT!!!')
		}
	}


	/**
	* Calls the active modules size() function
	* @param {*} key The key to check, this can be any valid object storage key
	* @returns {Promise<number|undefined>} A promise representing whether the size in bytes or undefined
	*/
	size(key) {
		if (!this.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		this.debug('Size', key);
		if (!_.isFunction(this.activeModule.size)) throw new Error('Size is not supported by the selected cache module');

		return Promise.resolve(this.activeModule.size(this.settings.keyMangle(key)));
	}


	/**
	* Release a set key, any subsequent get() call for this key will fail
	* @param {*|array} key The key or array of keys to release, this can be any valid object storage key
	* @returns {Promise} A promise which will resolve when the value has been unset
	*/
	unset(keys) {
		if (!this.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		return Promise.all(
			_.castArray(keys)
				.map(key => {
					this.debug('Unset', key);
					return this.activeModule.unset(this.settings.keyMangle(key))
				})
		);
	}


	/**
	* Return a list of current cache values
	* Only some drivers may implement this function
	* Each return item is expected to have at least 'id' with optional keys 'expiry', 'created'
	* @returns {Promise<Array>} A promise representing the cached items each item is of the form `{id, size?, expiry?}`
	*/
	list() {
		if (!this.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		this.debug('List');
		return Promise.resolve(this.activeModule.list());
	}


	/**
	* Attempt to clean up any remaining items
	* Only some drivers may implement this function
	* NOTE: If the driver does not implement BUT the driver has a list function that returns expiry data a simple loop + expiry check + unset worker will be implemented instead
	* @returns {Promise} A promise which will resolve when cleanup is complete
	*/
	clean() {
		if (!this.activeModule) throw new Error('No cache module loaded. Use cache.init() first');

		this.debug('Clean');

		if (_.isFunction(this.activeModule.clean)) { // Driver implments its own function
			return Promise.resolve(this.activeModule.clean());
		} else if (this.can('list')) { // Driver implements a list which we can use instead
			let now = new Date();
			return this.activeModule.list()
				.then(items => Promise.all(items.map(item =>
					item.id && item.expiry && item.expiry < now
						? this.activeModule.unset(item.id)
						: null
				)))
		} else {
			throw new Error('Clean is not supported by the selected cache module');
		}
	}


	/**
	* Attempt to erase ALL cache contents
	* Only some drivers may implement this function
	* NOTE: If the driver does not implement BUT the driver has a list function that returns expiry data a simple loop + expiry check + unset worker will be implemented instead
	* @returns {Promise} A promise which will resolve when the cache has been cleared
	*/
	clear() {
		if (!this.activeModule) throw new Error('No cache module loaded. Use cache.init() first');
		this.debug('Clear');

		if (this.activeModule.clear) { // Driver implments its own function
			return Promise.resolve(this.activeModule.clear());
		} else if (this.activeModule.list && this.activeModule.unset) { // Driver implements a list interface which we can use instead
			return Promise.resolve()
				.then(()=> this.activeModule.list())
				.then(items => Promise.all(items.map(item =>
					this.activeModule.unset(item.id)
				)))
		} else {
			throw new Error('Clear is not supported by the selected cache module');
		}
	}


	/**
	* Returns whether the loaded module supports a given function
	* @param {string} func The function to query
	* @returns {boolean} Whether the active module supports the action
	*
	* @example Can a module clear?
	* cache.can('clear') //= Value depends on module
	*/
	can(func) {
		switch (func) {
			case 'clear':
			case 'clean':
				return _.isFunction(this.activeModule[func])
				|| (_.isFunction(this.activeModule.list) && _.isFunction(this.activeModule.unset))
			default: // Also includes 'list'
				return !! _.isFunction(this.activeModule[func]);
		}
	}


	/**
	* Politely close all driver resource handles
	* NOTE: The destroy function will wait until all set() operations complete before calling the callback
	* @returns {Promise} A promise which will resolve when all drivers have been released
	*/
	destroy() {
		this.debug('Destroy');
		return Promise.resolve(
			this.can('destroy')
			? this.activeModule.destroy()
			: null
		)
			.then(()=> new Promise(resolve => {
				this.debug('Destroy - modules terminated');

				let dieAttempt = 0;
				let dieWait = 100;
				let tryDying = ()=> {
					if (this.flushing > 0) {
						this.debug(`Destory - still flushing. Attempt ${dieAttempt++}, will try again in ${dieWait}ms`);
						dieWait *= 2; // Increase wait backoff
						setTimeout(tryDying, dieWait);
					} else {
						resolve();
					}
				};

				tryDying();
			}))
	}


	/**
	* Helper function to read a local file into the cache
	* Since disk files are (kind of) immutable this function works as both a getter (fetch file contents) and a setter (populate into cache)
	* The file's stats are taken into account when reading so that changed files (filesize + date) get hydrated if needed
	*
	* @param {*} key The key to set
	* @param {string} path The file path to read
	* @param {date|number|string} [expiry] Optional expiry value
	* @returns {Promise<String>} A promise with the UTF-8 contents of the file post-read
	*
	* @emits fromFileRead Emited as `({path, contents})` when a file read occurs both values can be mutated in place
	*/
	fromFile(key, path, expiry) {
		return Promise.resolve()
			.then(()=> Promise.all([
				this.get(key),
				fs.stat(path),
			]))
			.then(([cacheEntry, stats]) => {
				if (
					!cacheEntry // No cache entry - needs reading for the first time
					|| cacheEntry.stats.size != stats.size // Size mismatch
					|| cacheEntry.stats.mtimeMs != stats.mtimeMs // Modified time mismatch
				) { // Create cache entry
					return fs.readFile(path, 'utf8')
						.then(contents => {
							this.debug('read path', path, 'into', key);
							this.emit('fromFileRead', {path, contents});

							return this.set(key, {
								path,
								contents,
								stats,
							}, expiry);
						})
						.then(newEntry => newEntry.contents) // Extract only contents
				} else { // Cache exists and is up to date - just return contents
					return cacheEntry.contents;
				}
			})
			.catch(e => {
				if (e === 'SKIP') return;
				throw e;
			});
	}


	/**
	* Simple wrapper middleware function which either returns the cached ID or runs a worker to calculate + cache a new one
	* NOTE: Since Promise execute immediately the worker must be a promise factory
	* @param {string|Object} options Options to use when caching, if this is a non-object its assumed to be the value of `options.id`
	* @param {string} options.id The ID of the cache to use
	* @param {boolean} [options.enabled=true] Whether to use the cache at all, set to false to debug the function worker each time
	* @param {string} [options.expiry="1h"] Any timesting valid entry to determine the maximum cache time
	* @param {boolean} [options.rejectAs=undefined] Cache throwing promises as this value rather than repeating them each hit
	* @param {number} [options.retry=0] If a promise rejects retry it this many times before giving up
	* @param {number|function} [options.retryDelay=100] Delay between promise retries, if a function is called as `(attempt, settings)` and expected to return the delay amount
	* @param {function} [options.onCached] Sync function to called as `(settings, value)` when using a valid cached value instead of hydrating the worker, if any value except `undef` is returned it is used as the returned value
	* @param {function} [options.onRetry] Sync function to call as `(error, attempt)` when a retryable operation fails, if any non-undefined is returned the retry cycle is aborted and the value used as the promise resolve value, if the function throws the entire promise retry cycle is exited with the thrown error as the rejection
	* @param {*} [options.invalidStore] Value use to detect the absence of a value in the cache (so we can detect null/undefined values even though they are falsy)
	* @param {function} worker The worker PROMISE FACTORY function to execute if the cache value does not exist, the result of this is used for the subsequent cache value
	* @returns {Promise<*>} A promise which will return with the result of worker - or the cached value of worker until it expires
	*
	* @example Return the cached response, otherwise compute it
	* cache.worker({id: 'myFunc'}, ()=> someBigPromise()).then(result => ...)
	*/
	worker(options, worker) {
		let settings = {
			id: !_.isPlainObject(options) ? options : undefined,
			enabled: true,
			expiry: '1h',
			// rejectAs: undefined, // If set we use rejectAs, otherwise leave unset so we can also detect `undefined` value
			retry: 0,
			retryDelay: 100,
			onCached: (settings, value) => {}, // eslint-disable-line no-unused-vars
			onRetry: e => console.warn(e),
			invalidStore: '!!!UNKNOWN!!!',
			...options,
		};
		if (!settings.id) throw new Error('No ID specified for cache.function(id, worker)');
		if (worker instanceof Promise) throw new Error('cache.function must be passed a PROMISE FACTORY not an already executing PROMISE');
		if (!_.isFunction(worker)) throw new Error('cache.function worker must be a function');

		// Bypass cache entirely when disabled
		if (!settings.enabled) return Promise.resolve(worker());

		return this.get(settings.id, settings.invalidStore)
			.then(res => new Promise((resolve, reject) => {
				let attempt = 0; // What attempt we are at now, increments for each `retry`
				if (res !== settings.invalidStore) return Promise.resolve() // Result found
					.then(()=> settings.onCached(settings, res)) // Call onCached and see if it mutates the value
					.then(output => output !== undefined ? output : res) // Use mutated, or fall back to original if undef
					.then(output => resolve(output)) // Close off the promise

				let tryResolve = ()=> { // Create repeatable promise factory function (so we can retry on fail)
					this.debug('Cache function refresh for', settings.id);
					Promise.resolve(worker()) // Execute worker as promisable
						.then(value => this.set(settings.id, value, settings.expiry).then(()=> value)) // Cache output result and return
						.then(value => resolve(value))
						.catch(e => {
							if (settings.hasOwn('rejectAs')) {
								this.debug('Cache func function refresh for', settings.id, 'threw', 'using fallback', settings.rejectAs);
								return this.set(settings.id, settings.rejectAs).then(()=> settings.rejectAs);
							} else if (settings.hasOwn('retry') && settings.hasOwn('retry') > 0) {
								if (++attempt > settings.retry) { // Exhausted retry limit - reject
									reject(e);
								} else {
									this.debug('Cache func function refresh for', settings.id, `threw on attempt ${attempt}`);
									try {
										let retryValue = settings.onRetry(e, attempt);
										if (retryValue !== undefined) return resolve(retryValue); // Did onRetry give us a value to use instead?
										let useDelay = _.isFunction(settings.retryDelay) ? settings.retryDelay(attempt, settings) : settings.retryDelay;
										if (!isFinite(useDelay)) return reject('Got non-numeric delay for retryDelay');
										setTimeout(tryResolve, useDelay);
									} catch (e) {
										this.debug('Cache func function refresh for', settings.id, `threw on attempt ${attempt}, rejecting with`, e.toString());
										return reject(e);
									}
								}
							} else {
								this.debug('Cache func function refresh for', settings.id, 'threw', e.toString());
								reject(e);
							}
						})
				};

				tryResolve();
			}))
	}


	/**
	* Utility function to hash complex objects
	* @param {*} val Value to hash. If this is a complex object it will be run via JSON.stringify
	* @returns {string} The SHA256 hash of the input
	*/
	hash(val) {
		return crypto.createHash('sha256')
			.update(!_.isObject(val) ? val : JSON.stringify(val))
			.digest('hex');
	}


	/**
	* Convert an input value into a Date object
	* This function can take dates, millisecond offsets, timestring() strings or moment objects
	* @param {number|string|Date|Moment} val The input value to convert
	* @returns {Date} A Date object
	*/
	convertDateRelative(val) {
		return !val ? undefined // Invalid object?
			: _.isDate(val) ? val // Already a date?
			: val.constructor.name == 'Moment' ? val.toDate() // Is a Moment object?
			: isFinite(val) ? new Date(Date.now() + Number(val)) // Looks like a number?
			: typeof val == 'string' ? new Date(Date.now() + timestring(val, 'ms')) // Relative time string
			: undefined;
	}


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
	promiseSeries(promises) {
		return promises.reduce((chain, promise) =>
			chain.then(()=>
				Promise.resolve(
					typeof promise == 'function' ? promise() : promise
				)
			)
			, Promise.resolve()
		);
	}


	/**
	* Constructor
	* @returns {Cache} A cache object instance
	*/
	constructor(options) {
		super();
		this.options(options);

		if (this.settings.init) this.init();
	}
}

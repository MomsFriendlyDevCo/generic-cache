import BaseCache from './base.js';
import Debug from 'debug';
import {createHash} from 'node:crypto';
import {dirName} from '@momsfriendlydevco/es6';
import fs from 'node:fs/promises';
import fsPath from 'node:path';
import {nanoid} from 'nanoid';

const __dirname = dirName();
const debug = Debug('cache');


export default class Cache extends BaseCache {
	getModulePath(mod) {
		let modPath = fsPath.normalize(`${__dirname}/../modules/${mod}.js`);

		// Deal with Windows import weirdness if required
		if (fsPath.sep == '\\' && /^\\\w:\\/.test(modPath)) modPath = `file://${modPath}`;
		return modPath;
	}


	debug(...args) {
		debug(...args);
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
				if (e === 'SKIP') {
					return;
				} else if (e instanceof Error) {
					throw e;
				} else {
					throw new Error(e);
				}
			});
	}


	/**
	* ExpressJS / Connect compatible middleware layer to provide caching middleware
	*
	* @param {String|Object} options Options for the eventual middleware. If a string `options.expiry` is assumed
	* @param {String} [options.expiry='5m'] The expiry of the cache item
	* @param {String|Object|Function<String|*>} [options.key] Overriding name (or hashable object) to use as the caching key, if omitted the `hash` method is used to calculate the key instead. If an async function it is run as `(req)`
	* @param {Function<String>} [options.keyMangle] How to mangle the now computed key string into the key that is actually stored within the cache. Defaults to prefixing with `'middleware/'`
	* @param {Function<String|*>} [options.hash] Fallback method if `options.key` is unspecified to hash the incomming request. Defaults to hashing the method, path, query and body
	* @param {Boolean} [options.eTag=true] Whether to generate + obey the eTag http spec. Clients providing a valid eTag will get a 304 response if that tag is still valid
	* @param {Function<String>} [options.hashETag] Async function to generate the client visible eTag from the computed key (post keyMangle)
	* @param {Object} [options.context] Function context used for `key`, `hash` & `cacheFilter` functions if called. Defaults to this cache instance
	* @param {Function<Boolean>} [options.cacheFilter] Async function used to determine whether the output value should be cached when generated. Called as `(req, res, content)` and expected to eventually return a boolean
	*
	* @returns {ExpressMiddleware} An ExpressJS / Connect compatible middleware function
	*/
	middleware(expiry, options) {
		let settings = {
			expiry: expiry || '1h',
			key: null,
			keyMangle: key => `middleware/${key}`,
			hash: req => ({
				method: req.method,
				path: req.path,
				query: req.query,
				body: req.body,
			}),
			eTag: true,
			hashETag: key => createHash('sha1').update(key).digest('base64'),
			context: this,
			cacheFilter: (req, res, content) => true,
			...(typeof options == 'string' ? {expiry: options} : options),
		};

		// Generate the Express middleware function from the above settings
		return (req, res, next) => {
			let keyHash; // Eventual lookup key string to use for the cache (derrived from settings.key || settings.hash(req))
			let eTagHash; // Cyphered version of keyHash to expose to the client

			return Promise.resolve()
				// Compute keyHash {{{
				.then(()=>
					typeof settings.key == 'string' ? settings.key // Simple string
					: settings.key && typeof settings.key == 'function' ? settings.key.call(settings.context, req) // Value via function
					: settings.key ? settings.key // Truthy value (could be anything)
					: settings.hash.call(settings.context, req) // Fallback to hash function
				)
				.then(kh => keyHash =
					typeof kh == 'string' ? kh // If a string, use as is
					: this.hash(kh) // Anything else? Run via Cache.hash()
				)
				.then(kh => keyHash = settings.keyMangle(kh))
				// }}}
				.then(()=> Promise.all([
					// Fetch cache value
					this.get(keyHash),

					// Compute hashETag
					settings.eTag && Promise.resolve(settings.hashETag(keyHash))
						.then(het => eTagHash = het),
				]))
				// Check for existing values, eTag matches or other cache-hits {{{
				.then(([cacheObj]) => {
					if (req.headers.etag && req.headers.etag == cacheObj.eTag) { // Incomming has eTag hash and it matches - tell client the version they have is already up to date
						res.sendStatus(304);
						throw 'EXIT';
					} else if (cacheObj) { // Client didn't ask for an eTag BUT we have a cached value anyway
						res.type('application/json');
						if (settings.eTag) res.set('etag', eTagHash);
						res.send(cacheObj.content);
						throw 'EXIT';
					} // Implied else - no cached value - need to recompute + set cache contents
				})
				// }}}
				// Execute the middleware worker - patching in our own post-worker data capture {{{
				.then(()=> { // Replace the res.json() handler with our own
					let rawJSONHandler = res.json; // Backup "real" Express JSON handler
					res.json = rawContent => Promise.resolve()
						.then(()=> settings.cacheFilter.call(settings.conext, req, res, rawContent))
						.then(canCache => canCache && this.set(
							keyHash,
							{
								eTag: eTagHash,
								content: rawContent,
							},
							settings.expiry
						))
						.then(()=> {
							res.type('application/json');
							if (settings.eTag) res.set('etag', eTagHash);
							rawJSONHandler.call(res, rawContent);
						});

					next(); // Continue Express middleware chain
				})
				// }}}
				// Catch {{{
			.catch(e => {
				if (e === 'EXIT') {
					return;
				} else if (e instanceof Error) {
					throw e;
				} else {
					throw new Error(e);
				}
			});
				// }}}
		};
	}


	/**
	* ExpressJS / Connect compatible middleware layer to provide a locking semaphore gateway
	* Multiple hits to the same endpoint will be throttled to the first hit only with all subsequent hits getting that result
	* Combine with `middleware()` for caching on top of this operation
	*
	* 1. Create a semaphore key with a UUID for the current session
	* 2. Let the worker function complete storing the eventual results against the session ID
	* 3. Resolve all subsequent slaves with the contents of the session ID
	*
	* @param {Object} [options] Additional options to mutate behaviour
	* @param {Boolean} [options.useLocal=true] Try to use local state promise chains first, this will capture cases only directed as a single process server
	* @param {String|Object|Function<String|*>} [options.key] Overriding name (or hashable object) to use as the caching key, if omitted the `hash` method is used to calculate the key instead. If an async function it is run as `(req)`
	* @param {Function<String>} [options.keyMangleLock] How to mangle the now computed key string into the lock that is actually stored within the cache
	* @param {Function<String>} [options.keyMangleSession] How to mangle the now computed key string into the session result that is actually stored within the cache
	* @param {string} [options.resultExpiry="5m"] How long to keep the resulting value before cleaning it up
	* @param {Function<String|*>} [options.hash] Fallback method if `options.key` is unspecified to hash the incomming request. Defaults to hashing the method, path, query and body
	* @param {Number} [options.retries=2400] Maximum number of retries to attempt when locking, set to zero to disable, this multiplied by the delay should exceed the maximum execution time of the worker function
	* @param {Number} [options.delay=250] Time in milliseconds to wait for a lock using the default backoff system
	* @param {String} [options.expiry='10m'] The expiry of the lock, this should exceed the maximum execution time of the worker function
	*
	* @returns {ExpressMiddleware} An ExpressJS / Connect compatible middleware function
	*/
	semaphore(options) {
		let settings = {
			useLocal: true,
			key: null,
			keyMangleLock: key => `semaphores/active/${key}`,
			keyMangleSession: key => `semaphores/sessions/${key}`,
			sessionExpiry: '5m',
			hash: req => ({
				method: req.method,
				path: req.path,
				query: req.query,
				body: req.body,
			}),
			retries: 2400,
			delay: 250,
			lockExpiry: '10m',
			...options,
		};

		return (req, res, next) => {
			let hash; // Actual user provided hash to compute keyHash + keyHashSession against
			let keyHash; // Eventual lookup key string to use for the cache (derrived from settings.key || settings.hash(req))

			let semaphorePromise = Promise.resolve()
				// Compute keyHash {{{
				.then(()=>
					typeof settings.key == 'string' ? settings.key // Simple string
					: settings.key && typeof settings.key == 'function' ? settings.key.call(settings.context, req) // Value via function
					: settings.key ? settings.key // Truthy value (could be anything)
					: settings.hash.call(settings.context, req) // Fallback to hash function
				)
				.then(kh => hash =
					typeof kh == 'string' ? kh // If a string, use as is
					: this.hash(kh) // Anything else? Run via Cache.hash()
				)
				.then(()=> keyHash = settings.keyMangleLock(hash))
				// }}}
				// Check local state {{{
				.then(()=> {
					if (!settings.useLocal) return; // Not allowed to use local state anyway
					if (this._semaphoreKeys[keyHash]) { // State exists - attach to that promise and quit
						debug('Reusing existing local state for key', keyHash);
						return this._semaphoreKeys[keyHash] // Will call res.send() on its own anyway
							.then(v => res.send(v))
							.finally(()=> { throw 'EXIT' }) // Terminate this promise chain
					} else { // State doesn't exist - create it and continue
						debug('Creating new local state for key', keyHash);
						this._semaphoreKeys[keyHash] = semaphorePromise
							.then(()=> delete this._semaphoreKeys[keyHash]) // Delete the running key lookup when done
					}
				})
				// }}}
				// Try to fetch the existing semaphore lock (if it exists) {{{
				.then(()=> this.get(keyHash))
				// }}}
				// If session exists - wait for it, otherwise create one {{{
				.then(sessionId => {
					if (sessionId) { // Existing lock - loop until its freed, returning the eventual result
						debug('Existing semaphore sessionId', sessionId, 'is active');
						return new Promise((resolve, reject) => {
							let tryCount = 0;
							let tryCheck = ()=> Promise.resolve()
								.then(()=> tryCount++)
								.then(()=> this.has(keyHash))
								.then(lockExists => {
									if (lockExists && (settings.retries == 0 || tryCount < settings.retries)) { // Lock still exists and can retry - reloop
										setTimeout(tryCheck, settings.delay);
									}  else if (lockExists) { // Lock still exists and we're out of retries
										reject('Unable to free semephore lock');
									} else { // Lock released
										return Promise.resolve()
											.then(()=> settings.keyMangleSession(sessionId))
											.then(keyHashSession => this.get(keyHashSession))
											.then(result => resolve(result))
											.catch(e => reject(e))
									}
								});

							tryCheck(); // Kick off initial check
						})
							.then(v => res.send(v))
					} else { // Create new session
						let sessionId = nanoid();
						debug('Creating new semaphore session', sessionId, 'for key', keyHash);

						return Promise.resolve()
							.then(()=> Promise.all([
								settings.keyMangleSession(sessionId), // Compute session key
								this.set(keyHash, sessionId), // Allocate lock
							]))
							.then(([sessionKey]) => new Promise((resolve, reject) => { // Replace the res.json() handler with our own
								let rawJSONHandler = res.json; // Backup "real" Express JSON handler
								res.json = rawContent => Promise.resolve()
									.then(()=> debug('Semaphore session', sessionId, 'set raw value', rawContent))
									.then(()=> this.set(sessionKey, rawContent, settings.sessionExpiry)) // Allocate session result
									.then(()=> this.unset(keyHash)) // Release original lock
									.then(()=> rawJSONHandler.call(res, rawContent)) // Call original JSON handler
									.then(()=> resolve(rawContent)) // Resolve outer promise with value
									.catch(e => {
										debug('Caught res.json() error -', e);
										reject(e);
									})

								next(); // Continue Express middleware chain
							}))
					}
				})
				// }}}
				// Catch {{{
				.catch(e => {
					if (e === 'EXIT') {
						return;
					} else if (e instanceof Error) {
						throw e;
					} else {
						throw new Error(e);
					}
				});
				// }}}

			return semaphorePromise;
		};
	}

	/**
	* Holding map for pending local semaphores
	* Each key is the computed keyhash for the request
	* Each value is the pending semaphore chain promise
	*
	* @type {Object<Promise>}
	*/
	_semaphoreKeys = {};
}
